// The projects page and its forms: create, rename, delete (the name typed to confirm), download and upload as zip.
// A project of another user is answered exactly like one that does not exist (404), so ids are never confirmed.
import type { IncomingMessage, ServerResponse } from "node:http"
import { audit, formTokenMatches, withRenewed, type Hub, type Signed } from "./context.js"
import { header, HubError, readBody, readForm, redirect, sendPage } from "./http.js"
import { boundaryOf, readMultipart } from "./multipart.js"
import { projectsPage } from "./pages.js"
import { newId } from "./secrets.js"
import type { Project } from "./store.js"
import { readZipArchive, ZipRefusal } from "./zip.js"

const MAX_NAME = 100
const UPLOAD_OVERHEAD = 64 * 1024

/** A project name: a label of 1 to 100 characters without control characters. Never a path. */
export function projectName(text: string | undefined): string | undefined {
  const name = (text ?? "").trim().normalize("NFC")
  return name.length >= 1 && name.length <= MAX_NAME && !/[\u0000-\u001f\u007f-\u009f]/.test(name) ? name : undefined
}

export async function showProjects(hub: Hub, res: ServerResponse, signed: Signed, renewed?: string, status = 200, error?: string, note?: string): Promise<void> {
  const projects = hub.store.projects(signed.user.id)
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
  const quota = await quotaProblem(hub, signed.user.id)
  if (quota) return showProjects(hub, res, signed, undefined, 403, quota)
  const project = { id: newId(), userId: signed.user.id, name, created: hub.config.now() }
  if (!hub.store.createProject(project)) return showProjects(hub, res, signed, undefined, 409, "You already have a project with that name.")
  await hub.files.create(signed.user.id, project.id)
  audit(hub, address, signed.user.id, "project-created", project.id)
  redirect(res, "/projects")
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
  await hub.runner.stop(id)
  await hub.files.remove(signed.user.id, id)
  hub.store.deleteProject(signed.user.id, id)
  audit(hub, address, signed.user.id, "project-deleted", id)
  redirect(res, "/projects")
}

export async function downloadProject(hub: Hub, res: ServerResponse, address: string, signed: Signed, id: string): Promise<void> {
  ownProject(hub, signed, id)
  res.writeHead(200, {
    "content-type": "application/zip",
    // The file is named by the generated id: the person's label never reaches a header.
    "content-disposition": `attachment; filename="copperflow-${id}.zip"`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  })
  audit(hub, address, signed.user.id, "project-downloaded", id)
  try {
    await hub.files.download(signed.user.id, id, (chunk) => new Promise((done, fail) => res.write(chunk, (error) => (error ? fail(error) : done()))))
    res.end()
  } catch (error) {
    hub.log(`download of project ${id} failed: ${(error as Error).message}`)
    res.destroy()
  }
}

/** A zip into a NEW project: refused whole, before anything is written, when any entry or limit is wrong. */
export async function uploadProject(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string, signed: Signed): Promise<void> {
  const body = await readBody(req, hub.config.maxBytes + UPLOAD_OVERHEAD)
  const form = readMultipart(body, boundaryOf(header(req, "content-type")))
  if (!formTokenMatches(signed, form.fields.get("form"))) throw new HubError(403, "The form has expired. Open the page again and retry.")
  const name = projectName(form.fields.get("name"))
  if (!name) return showProjects(hub, res, signed, undefined, 400, `A project name has 1 to ${MAX_NAME} characters.`)
  if (!form.file || form.file.field !== "archive") return showProjects(hub, res, signed, undefined, 400, "Choose a zip archive to upload.")
  const quota = await quotaProblem(hub, signed.user.id)
  if (quota) return showProjects(hub, res, signed, undefined, 403, quota)
  let entries
  try {
    entries = readZipArchive(form.file.data, hub.config.maxBytes - (await hub.files.usage(signed.user.id)))
  } catch (error) {
    if (!(error instanceof ZipRefusal)) throw error
    audit(hub, address, signed.user.id, "upload-refused", error.message)
    return showProjects(hub, res, signed, undefined, 400, `The archive was not uploaded: ${error.message}`)
  }
  const project = { id: newId(), userId: signed.user.id, name, created: hub.config.now() }
  if (!hub.store.createProject(project)) return showProjects(hub, res, signed, undefined, 409, "You already have a project with that name.")
  try {
    await hub.files.unpack(signed.user.id, project.id, entries)
  } catch (error) {
    await hub.files.remove(signed.user.id, project.id)
    hub.store.deleteProject(signed.user.id, project.id)
    hub.log(`upload into project ${project.id} failed: ${(error as Error).message}`)
    throw new HubError(400, "The archive could not be unpacked.")
  }
  audit(hub, address, signed.user.id, "project-uploaded", `${project.id} (${entries.length} files)`)
  redirect(res, "/projects")
}
