// The open_studio tool: reuse this project's running Studio or start one as its own process, open it in the
// person's browser, and give the address with its key.
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { runningStudio, studioAnswers, studioOpenUrl, studioUrl, readNote, type StudioNote } from "../studio/studio-note.js"

export const OPEN_STUDIO_DESCRIPTION =
  "Open the Studio, the visual editor, for the person: reuses this project's running Studio or starts one, and opens it in their browser. Call it when the person asks to open copperflow, the editor or the board, or wants to watch. Give them the address it returns, to them only."

export const openStudioInput = {
  open: z.boolean().optional().describe("Open the person's browser; default true"),
}

/** Starts the Studio process; `exited` settles if that process ends. */
export type StudioStarter = (root: string) => { pid?: number | undefined; exited?: Promise<number | null> }
/** Opens an address in the person's browser; false when it could not. */
export type BrowserOpener = (url: string) => Promise<boolean>

export interface OpenStudioPorts {
  root: string
  start?: StudioStarter
  /** The CLI the default starter runs; defaults to the running copperflow's cli.js. */
  cli?: string
  openBrowser?: BrowserOpener
  /** How long to wait for a started Studio's note. */
  waitMs?: number
}

export const IDLE_MINUTES = 60
const WAIT_MS = 30_000
const POLL_MS = 150

/** Studios this process started, by address with key, and starts in flight, by project. */
const startedHere = new Set<string>()
const starting = new Map<string, Promise<StudioNote>>()

export function studioArgs(cli: string, root: string): string[] {
  return [cli, "studio", "--root", root, "--idle-minutes", String(IDLE_MINUTES)]
}

export async function openStudio(ports: OpenStudioPorts, input: { open?: boolean | undefined }): Promise<string> {
  let note = await runningStudio(ports.root)
  let fresh = false
  if (note === undefined) {
    let pending = starting.get(ports.root)
    if (pending === undefined) {
      fresh = true
      pending = startAndWait(ports).finally(() => starting.delete(ports.root))
      starting.set(ports.root, pending)
    }
    note = await pending
  }
  const url = studioUrl(note)
  const lines = [`The Studio is running at ${url} (${fresh ? "started now" : "already running"}).`]
  if (input.open !== false) {
    const opened = await (ports.openBrowser ?? openInBrowser)(studioOpenUrl(note)).catch(() => false)
    lines[0] += opened ? " Opened it in the browser." : " Could not open a browser here: give the person this address."
  }
  lines.push(studioOpenUrl(note))
  const ownStop = startedHere.has(studioOpenUrl(note)) ? ` It stops by itself ${IDLE_MINUTES} minutes after the last tab closes.` : ""
  lines.push(`The address holds this session's key: give it to the person only.${ownStop}`)
  return lines.join("\n")
}

async function startAndWait(ports: OpenStudioPorts): Promise<StudioNote> {
  const start = ports.start ?? cliStarter(ports.cli ?? fileURLToPath(new URL("../cli.js", import.meta.url)))
  const { exited } = start(ports.root)
  let ended: number | null | undefined
  let hasEnded = false
  exited?.then((code) => {
    ended = code
    hasEnded = true
  }, () => (hasEnded = true))
  const waitMs = ports.waitMs ?? WAIT_MS
  for (let waited = 0; waited < waitMs; waited += POLL_MS) {
    const note = await readNote(ports.root)
    if (note !== undefined && (await studioAnswers(ports.root, note))) {
      startedHere.add(studioOpenUrl(note))
      return note
    }
    if (hasEnded) throw new Error(`The Studio did not start: its process ended (exit code ${ended ?? "unknown"}).`)
    await new Promise((done) => setTimeout(done, POLL_MS))
  }
  throw new Error(`The Studio did not start within ${waitMs / 1000} s.`)
}

/** Runs the CLI's studio command as its own process: detached, no shared pipes, no console window. */
export function cliStarter(cli: string): StudioStarter {
  return (root) => {
    const child = spawn(process.execPath, studioArgs(cli, root), { detached: true, stdio: "ignore", windowsHide: true })
    const exited = new Promise<number | null>((done) => {
      child.once("exit", (code) => done(code))
      child.once("error", () => done(null))
    })
    child.unref()
    return { pid: child.pid, exited }
  }
}

const OPENER_WAIT_MS = 5000

/** The system's way to open an address; the address is one argument, never part of a shell string. */
function openerFor(url: string): [string, string[]] {
  if (process.platform === "win32") return ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
  if (process.platform === "darwin") return ["open", [url]]
  return ["xdg-open", [url]]
}

/** Opens the address in the default browser; false when the opener is missing or fails. */
export function openInBrowser(url: string): Promise<boolean> {
  const [command, args] = openerFor(url)
  return new Promise((done) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true })
    const timer = setTimeout(() => done(true), OPENER_WAIT_MS)
    child.once("error", () => (clearTimeout(timer), done(false)))
    child.once("exit", (code) => (clearTimeout(timer), done(code === 0)))
    child.unref()
  })
}
