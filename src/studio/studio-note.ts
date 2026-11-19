// The note a running Studio leaves in the person's own folder (<home>/.copperflow/run/<sha256 of the root>.json), so
// an agent's open_studio and `copperflow studio stop` find it. Nothing in a project folder can stand in for it. The
// note holds no address: the address is always built from its port, and only a Studio that answers with the note's
// key and names this project's root counts.
import { createHash } from "node:crypto"
import { request } from "node:http"
import { realpathSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { z } from "zod"
import { copperflowHome } from "../core/home.js"
import type { AgentActivity } from "./activity-event.js"

export { copperflowHome }

export interface StudioNote {
  pid: number
  port: number
  key: string
  root: string
  started: string
  /** "desktop" when the desktop app's window shows this Studio; open_studio then brings it to the front. */
  host?: "desktop"
}

const NoteSchema = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65535),
  key: z.string().regex(/^[0-9a-f]{48}$/),
  root: z.string(),
  started: z.string(),
  host: z.literal("desktop").optional(),
})

const ANSWER_TIMEOUT_MS = 2000
const STOP_WAIT_MS = 10_000
const POLL_MS = 100


/**
 * The folder's real path: one spelling for a folder reached through a link, a relative path or, on Windows, another
 * case of the drive letter. A folder that is not there keeps its resolved path.
 */
export function projectRoot(root: string): string {
  const resolved = resolve(root)
  try {
    return realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

export function notePath(root: string): string {
  const hash = createHash("sha256").update(projectRoot(root)).digest("hex")
  return join(copperflowHome(), "run", `${hash}.json`)
}

/** The only address ever requested or opened: built from the note's checked port. */
export function studioUrl(note: StudioNote): string {
  return `http://127.0.0.1:${note.port}`
}

export function studioOpenUrl(note: StudioNote): string {
  return `${studioUrl(note)}/#token=${note.key}`
}

/** Writes the note, for the owner only where the system supports it. */
export async function writeNote(root: string, note: StudioNote): Promise<void> {
  const path = notePath(root)
  await mkdir(join(copperflowHome(), "run"), { recursive: true, mode: 0o700 })
  await rm(path, { force: true })
  await writeFile(path, `${JSON.stringify(note, null, 2)}\n`, { mode: 0o600 })
}

/** The note, or undefined when there is none, it fails the checks, or it names another root. */
export async function readNote(root: string): Promise<StudioNote | undefined> {
  const text = await readFile(notePath(root), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  try {
    const parsed = NoteSchema.safeParse(JSON.parse(text))
    return parsed.success && parsed.data.root === projectRoot(root) ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/** Removes the note; with a pid, only when the note is that process's. */
export async function removeNote(root: string, pid?: number): Promise<void> {
  if (pid !== undefined && (await readNote(root))?.pid !== pid) return
  await rm(notePath(root), { force: true })
}

interface CallOptions {
  /** Sent as JSON. */
  body?: unknown
  /** The whole request's limit, answer included; ANSWER_TIMEOUT_MS by default. */
  timeoutMs?: number
}

/** One request to the note's Studio with its key; undefined when it could not be made or took too long. */
function call(note: StudioNote, method: "GET" | "POST", path: string, options: CallOptions = {}): Promise<{ status: number; body: string } | undefined> {
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body)
  const headers = { "x-copperflow-token": note.key, ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) }) }
  return new Promise((done) => {
    const req = request({ host: "127.0.0.1", port: note.port, method, path, headers }, (res) => {
      let body = ""
      res.setEncoding("utf8")
      res.on("data", (chunk: string) => (body += chunk))
      res.on("end", () => (clearTimeout(limit), done({ status: res.statusCode ?? 0, body })))
      res.on("error", () => (clearTimeout(limit), done(undefined)))
    })
    // A limit on the whole request, not on idle time only: a Studio that answers slowly counts as not answering.
    const limit = setTimeout(() => req.destroy(), options.timeoutMs ?? ANSWER_TIMEOUT_MS)
    req.on("error", () => (clearTimeout(limit), done(undefined)))
    req.end(payload)
  })
}

/**
 * True when the note's Studio answers GET /api/studio, with the note's key, naming this project's root, within
 * `timeoutMs` (ANSWER_TIMEOUT_MS by default).
 */
export async function studioAnswers(root: string, note: StudioNote, timeoutMs?: number): Promise<boolean> {
  const answer = await call(note, "GET", "/api/studio", timeoutMs === undefined ? {} : { timeoutMs })
  if (answer?.status !== 200) return false
  try {
    const parsed = JSON.parse(answer.body) as { ok?: boolean; data?: { root?: unknown } }
    return parsed.ok === true && parsed.data?.root === projectRoot(root)
  } catch {
    return false
  }
}

/** The note of the Studio running for this project; a stale or bad note is removed and gives undefined. */
export async function runningStudio(root: string): Promise<StudioNote | undefined> {
  const note = await readNote(root)
  if (note !== undefined && (await studioAnswers(root, note))) return note
  await rm(notePath(root), { force: true })
  return undefined
}

/** Asks a Studio the desktop app shows to bring its window to the front; whether it did. */
export async function focusStudio(note: StudioNote): Promise<boolean> {
  return (await call(note, "POST", "/api/focus"))?.status === 200
}

/** Tells the note's Studio what the agent is doing (POST /api/activity) within `timeoutMs`; whether it took it. */
export async function postActivity(note: StudioNote, activity: AgentActivity, timeoutMs: number): Promise<boolean> {
  return (await call(note, "POST", "/api/activity", { body: activity, timeoutMs }))?.status === 200
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

/**
 * `copperflow studio stop`: asks this project's Studio to stop itself (an authenticated POST) and waits for its
 * note to go. Never ends a process by pid.
 */
export async function stopStudio(root: string): Promise<string> {
  const note = await runningStudio(root)
  if (note === undefined) return "No Studio is running for this folder."
  const answer = await call(note, "POST", "/api/stop")
  if (answer?.status !== 200) throw new Error(`The Studio at ${studioUrl(note)} did not accept the request to stop.`)
  for (let waited = 0; waited < STOP_WAIT_MS; waited += POLL_MS) {
    if ((await readNote(root)) === undefined) return `Stopped the Studio at ${studioUrl(note)}.`
    await wait(POLL_MS)
  }
  if (await studioAnswers(root, note)) throw new Error(`The Studio at ${studioUrl(note)} did not stop.`)
  await removeNote(root, note.pid)
  return `Stopped the Studio at ${studioUrl(note)}.`
}
