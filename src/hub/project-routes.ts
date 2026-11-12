// The projects page and its forms: create, rename, delete (the name typed to confirm), download and upload as zip.
// A project of another user is answered exactly like one that does not exist (404), so ids are never confirmed.
import type { IncomingMessage, ServerResponse } from "node:http"
import { audit, formTokenMatches, withRenewed, withUserLock, type Hub, type Signed } from "./context.js"
import { rm } from "node:fs/promises"
import { header, HubError, readForm, redirect, sendPage } from "./http.js"
import { boundaryOf } from "./multipart.js"
import { StorageError, streamMultipart } from "./multipart-stream.js"
import type { Writable } from "node:stream"
import { projectsPage } from "./pages.js"
import { newId } from "./secrets.js"
import type { Project } from "./store.js"
import { ZipRefusal } from "./zip.js"
import { checkZipFile } from "./zip-stream.js"

const MAX_NAME = 100
const UPLOAD_OVERHEAD = 64 * 1024
/** Uploads running at once in the whole hub. */
export const MAX_UPLOADS = 4
/** An upload is stopped after this long without a byte, or below this average rate once this long has passed. */
export const UPLOAD_IDLE_MS = 30_000
export const UPLOAD_MIN_BYTES_PER_S = 32 * 1024
export const UPLOAD_RATE_AFTER_MS = 30_000
/** Downloads one user runs at once. */
export const MAX_DOWNLOADS_PER_USER = 2

/** A project name: a label of 1 to 100 characters without control characters. Never a path. */
export function projectName(text: string | undefined): string | undefined {
  const name = (text ?? "").trim().normalize("NFC")
  return name.length >= 1 && name.length <= MAX_NAME && !/[\u0000-\u001f\u007f-\u009f]/.test(name) ? name : undefined
}

export async function showProjects(hub: Hub, res: ServerResponse, signed: Signed, renewed?: string, status = 200, error?: string, note?: string): Promise<void> {
  const projects = hub.store.projects(signed.user.id).map((project) => ({ ...project, overQuota: hub.store.overQuota(project.id) }))
  const usage = { projects: projects.length, maxProjects: hub.config.maxProjects, bytes: await hub.files.usage(signed.user.id), maxBytes: hub.config.maxBytes }
  sendPage(res, status, projectsPage({ email: signed.user.email, formToken: signed.formToken }, projects, usage, error, note), withRenewed(renewed))
}

/** The user's project, or 404 for one that is missing or belongs to someone else. */
export function ownProject(hub: Hub, signed: Signed, id: string): Project {
  const project = hub.store.project(signed.user.id, id)
  if (!project) throw new HubError(404, "There is no such page.")
  return project
}

/** Refuses when the user is at the plan's project count or disk use. */
async function quotaProblem(hub: Hub, userId: string): Promise<string | undefined> {
  if (hub.store.projectCount(userId) >= hub.config.maxProjects) return `You have ${hub.config.maxProjects} projects, the most the plan allows. Delete one first.`
  if ((await hub.files.usage(userId)) >= hub.config.maxBytes) return "Your projects use all the disk space the plan allows. Delete files or a project first."
  return undefined
}

async function checkedForm(req: IncomingMessage, signed: Signed): Promise<Map<string, string>> {
  const form = await readForm(req)
  if (!formTokenMatches(signed, form.get("form"))) throw new HubError(403, "The form has expired. Open the page again and retry.")
  return form
}

export async function createProject(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string, signed: Signed): Promise<void> {
  const form = await checkedForm(req, signed)
  const name = projectName(form.get("name"))
  if (!name) return showProjects(hub, res, signed, undefined, 400, `A project name has 1 to ${MAX_NAME} characters.`)
  const made = await addProject(hub, signed.user.id, name, address)
  if ("problem" in made) return showProjects(hub, res, signed, undefined, made.problem.status, made.problem.text)
  redirect(res, "/projects")
}

/**
 * Creates a project: check, insert and create run under the user's lock, so concurrent requests cannot pass the quota
 * together. `stillValid` is asked after every wait, before anything is written (an agent's token may be revoked
 * meanwhile); when it says no, nothing is made.
 */
export async function addProject(hub: Hub, userId: string, name: string, address: string, stillValid: () => boolean = () => true): Promise<{ project: Project } | { problem: { status: number; text: string } }> {
  const revoked = { problem: { status: 403, text: "Access was revoked." } }
  return withUserLock(hub, userId, async () => {
    if (!stillValid()) return revoked
    const quota = await quotaProblem(hub, userId)
    if (quota) return { problem: { status: 403, text: quota } }
    if (!stillValid()) return revoked
    const project = { id: newId(), userId, name, created: hub.config.now() }
    const refused = insertProject(hub, project)
    if (refused) return { problem: refused }
    await hub.files.create(userId, project.id)
    audit(hub, address, userId, "project-created", project.id)
    return { project }
  })
}

/** Inserts the row with the count check in the same transaction; the refusal to show, if any. */
function insertProject(hub: Hub, project: Project): { status: number; text: string } | undefined {
  const result = hub.store.createProject(project, hub.config.maxProjects)
  if (result === "full") return { status: 403, text: `You have ${hub.config.maxProjects} projects, the most the plan allows. Delete one first.` }
  if (result === "taken") return { status: 409, text: "You already have a project with that name." }
  return undefined
}

export async function renameProject(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string, signed: Signed, id: string): Promise<void> {
  const form = await checkedForm(req, signed)
  ownProject(hub, signed, id)
  const name = projectName(form.get("name"))
  if (!name) return showProjects(hub, res, signed, undefined, 400, `A project name has 1 to ${MAX_NAME} characters.`)
  const result = hub.store.renameProject(signed.user.id, id, name)
  if (result === "missing") throw new HubError(404, "There is no such page.")
  if (result === "taken") return showProjects(hub, res, signed, undefined, 409, "You already have a project with that name.")
  audit(hub, address, signed.user.id, "project-renamed", id)
  redirect(res, "/projects")
}

export async function deleteProject(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string, signed: Signed, id: string): Promise<void> {
  const form = await checkedForm(req, signed)
  const project = ownProject(hub, signed, id)
  if ((form.get("confirm") ?? "").trim().normalize("NFC") !== project.name) {
    return showProjects(hub, res, signed, undefined, 400, "Type the project's name exactly to delete it.")
  }
  // Marked first: from here every route and the proxy answer 404, so nothing restarts the workspace while it goes.
  hub.store.markProjectDeleted(signed.user.id, id)
  await hub.runner.stop(id)
  await hub.files.remove(signed.user.id, id)
  hub.store.deleteProject(signed.user.id, id)
  audit(hub, address, signed.user.id, "project-deleted", id)
  redirect(res, "/projects")
}

export async function downloadProject(hub: Hub, res: ServerResponse, address: string, signed: Signed, id: string): Promise<void> {
  ownProject(hub, signed, id)
  const running = hub.transfers.downloads.get(signed.user.id) ?? 0
  if (running >= MAX_DOWNLOADS_PER_USER) throw new HubError(429, `You have ${MAX_DOWNLOADS_PER_USER} downloads running. Try again when one has finished.`, { "retry-after": "30" })
  hub.transfers.downloads.set(signed.user.id, running + 1)
  try {
    await streamDownload(hub, res, address, signed, id)
  } finally {
    const left = (hub.transfers.downloads.get(signed.user.id) ?? 1) - 1
    if (left > 0) hub.transfers.downloads.set(signed.user.id, left)
    else hub.transfers.downloads.delete(signed.user.id)
  }
}

async function streamDownload(hub: Hub, res: ServerResponse, address: string, signed: Signed, id: string): Promise<void> {
  res.writeHead(200, {
    "content-type": "application/zip",
    // The file is named by the generated id: the person's label never reaches a header.
    "content-disposition": `attachment; filename="copperflow-${id}.zip"`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  })
  audit(hub, address, signed.user.id, "project-downloaded", id)
  try {
    await hub.files.download(signed.user.id, id, res)
    res.end()
  } catch (error) {
    hub.log(`download of project ${id} failed: ${(error as Error).message}`)
    res.destroy()
  }
}

/**
 * A zip into a NEW project. At most `MAX_UPLOADS` run in the hub and one per user (under the user's lock, taken before
 * the body is read). The body streams to a file under the data directory with the size cap enforced while it arrives;
 * the archive is checked on disk, then inflated entry by entry. Any refusal leaves nothing behind.
 */
export async function uploadProject(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string, signed: Signed): Promise<void> {
  const boundary = boundaryOf(header(req, "content-type"))
  const userId = signed.user.id
  const upload = paced(req)
  // One upload per user, refused at once: a user's parallel uploads never queue while holding hub-wide slots.
  if (hub.transfers.uploadingUsers.has(userId)) {
    upload.stop()
    throw new HubError(429, "One of your uploads is still running. Try again when it has finished.", { "retry-after": "30" })
  }
  hub.transfers.uploadingUsers.add(userId)
  try {
    const problem = await withUserLock(hub, userId, async () => {
      // The hub-wide slot is taken only when this user's upload actually starts.
      if (hub.transfers.uploads >= MAX_UPLOADS) throw new HubError(503, "Too many uploads are running. Try again in a minute.", { "retry-after": "60" })
      hub.transfers.uploads += 1
      try {
        return await receiveUpload(hub, upload.body, address, signed, boundary)
      } finally {
        hub.transfers.uploads -= 1
      }
    })
    if (problem) return showProjects(hub, res, signed, undefined, problem.status, problem.text)
    redirect(res, "/projects")
  } finally {
    upload.stop()
    hub.transfers.uploadingUsers.delete(userId)
  }
}

/**
 * The request body as it arrives, refused (408) when it stalls for `UPLOAD_IDLE_MS` or averages less than
 * `UPLOAD_MIN_BYTES_PER_S` once `UPLOAD_RATE_AFTER_MS` have passed.
 */
export function paced(
  req: Pick<IncomingMessage, "setTimeout" | "destroy"> & AsyncIterable<unknown> & { socket?: { bytesRead: number } | null },
  limits = { idleMs: UPLOAD_IDLE_MS, minBytesPerS: UPLOAD_MIN_BYTES_PER_S, rateAfterMs: UPLOAD_RATE_AFTER_MS, checkMs: 1000 },
): { body: AsyncGenerator<Buffer>; stop(): void } {
  // The clocks start now, when the request arrives, before it waits for a lock or a slot. Bytes are counted as they
  // reach the socket, so a request that waits is not taken for a slow one.
  const started = Date.now()
  const startBytes = req.socket?.bytesRead ?? 0
  let read = 0
  const arrived = () => (req.socket ? req.socket.bytesRead - startBytes : read)
  const tooSlow = () => new HubError(408, "The upload was too slow and was stopped. Try again on a faster connection.")
  req.setTimeout(limits.idleMs, () => req.destroy(tooSlow()))
  const check = setInterval(() => {
    const elapsed = Date.now() - started
    if (elapsed >= limits.rateAfterMs && arrived() / (elapsed / 1000) < limits.minBytesPerS) req.destroy(tooSlow())
  }, limits.checkMs)
  check.unref()
  const stop = () => clearInterval(check)
  async function* body(): AsyncGenerator<Buffer> {
    try {
      for await (const chunk of req) {
        read += (chunk as Buffer).length
        yield chunk as Buffer
      }
    } catch (error) {
      throw error instanceof HubError ? error : tooSlow()
    } finally {
      stop()
    }
  }
  return { body: body(), stop }
}

type Problem = { status: number; text: string } | undefined

async function receiveUpload(hub: Hub, body: AsyncIterable<Buffer>, address: string, signed: Signed, boundary: string): Promise<Problem> {
  const quota = await quotaProblem(hub, signed.user.id)
  if (quota) return { status: 403, text: quota }
  const temp = await hub.files.uploadPath()
  let sink: Writable | undefined
  try {
    const form = await streamMultipart(body, boundary, hub.config.maxBytes + UPLOAD_OVERHEAD, () => (sink = hub.files.uploadSink(temp)))
    if (!formTokenMatches(signed, form.fields.get("form"))) throw new HubError(403, "The form has expired. Open the page again and retry.")
    const name = projectName(form.fields.get("name"))
    if (!name) return { status: 400, text: `A project name has 1 to ${MAX_NAME} characters.` }
    if (form.fileField !== "archive") return { status: 400, text: "Choose a zip archive to upload." }
    return await unpackUpload(hub, address, signed, name, temp)
  } catch (error) {
    if (error instanceof StorageError) {
      hub.log(`upload could not be stored: ${(sinkError(sink) as NodeJS.ErrnoException | undefined)?.code ?? "unknown"}`)
      return { status: error.status, text: error.message }
    }
    throw error
  } finally {
    // The stream must have closed before its file can go (Windows refuses to remove an open file).
    if (sink && !sink.closed) await new Promise<void>((done) => sink?.once("close", () => done()))
    await rm(temp, { force: true })
  }
}

function sinkError(sink: Writable | undefined): unknown {
  return sink?.errored ?? undefined
}

async function unpackUpload(hub: Hub, address: string, signed: Signed, name: string, temp: string): Promise<Problem> {
  const refusedWith = (error: ZipRefusal): Problem => {
    audit(hub, address, signed.user.id, "upload-refused", error.message)
    return { status: 400, text: `The archive was not uploaded: ${error.message}` }
  }
  let zip
  try {
    zip = await checkZipFile(temp, hub.config.maxBytes - (await hub.files.usage(signed.user.id)))
  } catch (error) {
    if (error instanceof ZipRefusal) return refusedWith(error)
    throw error
  }
  const project = { id: newId(), userId: signed.user.id, name, created: hub.config.now() }
  const refused = insertProject(hub, project)
  if (refused) return refused
  try {
    await hub.files.unpack(signed.user.id, project.id, zip)
  } catch (error) {
    await hub.files.remove(signed.user.id, project.id)
    hub.store.deleteProject(signed.user.id, project.id)
    if (error instanceof ZipRefusal) return refusedWith(error)
    hub.log(`upload into project ${project.id} failed: ${(error as Error).message}`)
    throw new HubError(400, "The archive could not be unpacked.")
  }
  audit(hub, address, signed.user.id, "project-uploaded", `${project.id} (${zip.files.length} files)`)
  return undefined
}
