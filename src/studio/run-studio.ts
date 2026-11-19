// `copperflow studio`: start the Studio on 4777 or a free port, leave the note, and close it (and remove the note)
// on stop, on the idle stop, or when the process is told to end.
import { startStudio, type Studio, type StudioOptions } from "./server.js"
import { projectRoot, removeNote, writeNote, type StudioNote } from "./studio-note.js"

export const DEFAULT_STUDIO_PORT = 4777
const MS_PER_MINUTE = 60_000

export interface RunStudioOptions extends Omit<StudioOptions, "port" | "idleMs" | "onIdle" | "onStop"> {
  /** The person's --port; without it the default port is tried, then a free one. */
  port?: number | undefined
  /** Tests only: the port tried first when none is given. */
  defaultPort?: number
  idleMinutes?: number
  /** Tests only: the idle period in ms, over idleMinutes. */
  idleMs?: number
}

export interface RunningStudio {
  studio: Studio
  note: StudioNote
  /** Closes the Studio and removes its note; safe to call more than once. */
  stop(): Promise<void>
  /** Settles once the Studio closed, by stop or by the idle stop. */
  stopped: Promise<void>
}

export async function runStudio(options: RunStudioOptions): Promise<RunningStudio> {
  const { port, defaultPort, idleMinutes, idleMs, ...rest } = options
  const idlePeriod = idleMs ?? (idleMinutes !== undefined ? idleMinutes * MS_PER_MINUTE : undefined)
  let stop: () => Promise<void> = async () => {}
  // The idle stop, a stop request and Ctrl+C all take the same close path.
  const studioOptions: StudioOptions = { ...rest, onStop: () => void stop(), ...(idlePeriod !== undefined ? { idleMs: idlePeriod, onIdle: () => void stop() } : {}) }
  const studio = await listen(studioOptions, port, defaultPort ?? DEFAULT_STUDIO_PORT)
  const note: StudioNote = {
    pid: process.pid,
    port: Number(new URL(studio.url).port),
    key: studio.token,
    root: projectRoot(options.root),
    started: new Date().toISOString(),
    ...(options.host === undefined ? {} : { host: options.host }),
  }
  let settle: () => void = () => {}
  const stopped = new Promise<void>((done) => (settle = done))
  let stopping: Promise<void> | undefined
  stop = () =>
    (stopping ??= (async () => {
      try {
        await studio.close()
      } finally {
        await removeNote(options.root, note.pid)
        settle()
      }
    })())
  try {
    await writeNote(options.root, note)
  } catch (error) {
    await studio.close()
    throw error
  }
  return { studio, note, stop: () => stop(), stopped }
}

async function listen(options: StudioOptions, port: number | undefined, defaultPort: number): Promise<Studio> {
  try {
    return await startStudio({ ...options, port: port ?? defaultPort })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error
    if (port !== undefined) throw new Error(`Port ${port} is already in use. Leave out --port to use a free one.`)
    return freePort(options)
  }
}

/** Ports browsers refuse to open (the WHATWG "bad ports" list, from 1024 up). */
const BROWSER_BLOCKED_PORTS = new Set([
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
])
const MAX_PORT_TRIES = 8

/** A Studio on a free port a browser is willing to open. */
async function freePort(options: StudioOptions): Promise<Studio> {
  for (let tries = 1; ; tries++) {
    const studio = await startStudio({ ...options, port: 0 })
    if (!BROWSER_BLOCKED_PORTS.has(Number(new URL(studio.url).port)) || tries >= MAX_PORT_TRIES) return studio
    await studio.close()
  }
}
