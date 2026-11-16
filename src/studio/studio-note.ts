// The note a running Studio leaves in <root>/.copperflow/studio.json, so an agent's open_studio and
// `copperflow studio stop` find it. A note proves nothing by itself: only a Studio that answers with the note's
// key, for this project and from the note's process, counts.
import { request } from "node:http"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { z } from "zod"

export interface StudioNote {
  pid: number
  port: number
  url: string
  openUrl: string
  started: string
}

const NoteSchema = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65535),
  url: z.string(),
  openUrl: z.string(),
  started: z.string(),
})

const ANSWER_TIMEOUT_MS = 2000
const STOP_WAIT_MS = 5000
const STOP_POLL_MS = 100

export function notePath(root: string): string {
  return join(root, ".copperflow", "studio.json")
}

/** Writes the note, readable by the owner only where the system supports it, and keeps it out of commits. */
export async function writeNote(root: string, note: StudioNote): Promise<void> {
  const dir = join(root, ".copperflow")
  await mkdir(dir, { recursive: true })
  // "wx" never touches a .gitignore that is already there.
  await writeFile(join(dir, ".gitignore"), "studio.json\n", { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error
  })
  await rm(notePath(root), { force: true })
  await writeFile(notePath(root), `${JSON.stringify(note, null, 2)}\n`, { mode: 0o600 })
}

/** The note, or undefined when there is none or it is not a note. */
export async function readNote(root: string): Promise<StudioNote | undefined> {
  const text = await readFile(notePath(root), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  try {
    const parsed = NoteSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/** Removes the note; with a pid, only when the note is that process's. */
export async function removeNote(root: string, pid?: number): Promise<void> {
  if (pid !== undefined && (await readNote(root))?.pid !== pid) return
  await rm(notePath(root), { force: true })
}

function keyOf(note: StudioNote): string | undefined {
  const hash = note.openUrl.indexOf("#token=")
  return hash === -1 ? undefined : note.openUrl.slice(hash + "#token=".length)
}

/**
 * True when the note's address answers as this project's Studio: GET /api/project answers only with the right
 * key, and names this folder and the note's process.
 */
export async function studioAnswers(root: string, note: StudioNote): Promise<boolean> {
  const key = keyOf(note)
  if (key === undefined || note.url !== `http://127.0.0.1:${note.port}`) return false
  const body = await new Promise<string | undefined>((done) => {
    const req = request(
      { host: "127.0.0.1", port: note.port, path: "/api/project", headers: { "x-copperflow-token": key }, timeout: ANSWER_TIMEOUT_MS },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          return done(undefined)
        }
        let text = ""
        res.setEncoding("utf8")
        res.on("data", (chunk: string) => (text += chunk))
        res.on("end", () => done(text))
        res.on("error", () => done(undefined))
      },
    )
    req.on("timeout", () => req.destroy())
    req.on("error", () => done(undefined))
    req.end()
  })
  if (body === undefined) return false
  try {
    const answer = JSON.parse(body) as { ok?: boolean; data?: { name?: unknown; pid?: unknown } }
    return answer.ok === true && answer.data?.name === basename(root) && answer.data.pid === note.pid
  } catch {
    return false
  }
}

/** The note of the Studio running for this project; a stale note is removed and gives undefined. */
export async function runningStudio(root: string): Promise<StudioNote | undefined> {
  const note = await readNote(root)
  if (note === undefined) {
    await rm(notePath(root), { force: true })
    return undefined
  }
  if (await studioAnswers(root, note)) return note
  await removeNote(root, note.pid)
  return undefined
}

/** `copperflow studio stop`: ends this project's Studio, checked as open_studio checks it, and removes its note. */
export async function stopStudio(root: string, kill: (pid: number) => void = (pid) => process.kill(pid)): Promise<string> {
  const note = await runningStudio(root)
  if (note === undefined) return "No Studio is running for this folder."
  kill(note.pid)
  for (let waited = 0; waited < STOP_WAIT_MS && (await studioAnswers(root, note)); waited += STOP_POLL_MS) {
    await new Promise((done) => setTimeout(done, STOP_POLL_MS))
  }
  await removeNote(root, note.pid)
  return `Stopped the Studio at ${note.url}.`
}
