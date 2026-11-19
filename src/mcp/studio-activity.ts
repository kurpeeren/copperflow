// Tells this project's running Studio what the agent is doing, so the person watching sees "Agent: Routing: 3 of 8
// connections" instead of files changing for no visible reason. The Studio is found as open_studio finds it (the note,
// its key, the root it answers with), and the finding is kept a few seconds rather than read on every tick. Everything
// here is best effort: a Studio that is closed, slow or gone costs a tool at most one short wait, never its answer.
import type { AgentActivity } from "../studio/activity-event.js"
import { postActivity, readNote, studioAnswers, type StudioNote } from "../studio/studio-note.js"

/** How long a found (or not found) Studio is trusted before the note is read again. */
export const STUDIO_CACHE_MS = 4000
/** The longest a post or a lookup may take; a Studio slower than this is skipped. */
export const STUDIO_POST_TIMEOUT_MS = 1000

export interface StudioLinkPorts {
  root: string
  /** The Studio running for this root and answering, or undefined; by default the note checked with the Studio. */
  find?: (root: string) => Promise<StudioNote | undefined>
  /** Sends one activity; whether the Studio took it. */
  post?: (note: StudioNote, activity: AgentActivity) => Promise<boolean>
  now?: () => number
  /** Hears one line the first time posting to a Studio fails; stderr by default (stdout is the MCP stream). */
  warn?: (line: string) => void
}

export interface StudioLink {
  /** Whether a Studio is running for this project now (looked up at most every STUDIO_CACHE_MS). */
  present(): Promise<boolean>
  /** Queues the activity for the Studio; a newer one replaces one still waiting, as only the newest is shown. */
  tell(activity: AgentActivity): void
  /** Settles once every queued activity was sent or given up; for tests and for a clean exit. */
  settled(): Promise<void>
}

/** The note of this root's Studio, when that Studio answers within the post timeout; never removes a note. */
async function answeringStudio(root: string): Promise<StudioNote | undefined> {
  const note = await readNote(root)
  if (note === undefined) return undefined
  return (await studioAnswers(root, note, STUDIO_POST_TIMEOUT_MS)) ? note : undefined
}

/** The Studio found for `root`, kept STUDIO_CACHE_MS, one lookup at a time; `forget` drops the finding. */
function cachedFinder(root: string, find: (root: string) => Promise<StudioNote | undefined>, now: () => number) {
  let found: { at: number; note: StudioNote | undefined } | undefined
  let looking: Promise<StudioNote | undefined> | undefined
  const lookup = (): Promise<StudioNote | undefined> => {
    if (found !== undefined && now() - found.at < STUDIO_CACHE_MS) return Promise.resolve(found.note)
    looking ??= find(root)
      // A failed lookup is the same as no Studio: the agent's work does not depend on one.
      .catch(() => undefined)
      .then((note) => ((found = { at: now(), note }), note))
      .finally(() => (looking = undefined))
    return looking
  }
  return { lookup, forget: () => (found = undefined) }
}

export function studioLink(ports: StudioLinkPorts): StudioLink {
  const post = ports.post ?? ((note: StudioNote, activity: AgentActivity) => postActivity(note, activity, STUDIO_POST_TIMEOUT_MS))
  const warn = ports.warn ?? ((line: string) => process.stderr.write(`${line}\n`))
  const { lookup, forget } = cachedFinder(ports.root, ports.find ?? answeringStudio, ports.now ?? Date.now)
  const warned = new Set<number>()
  let waiting: AgentActivity | undefined
  let sending: Promise<void> | undefined

  const sendOne = async (activity: AgentActivity) => {
    const note = await lookup()
    if (note === undefined) return
    const took = await post(note, activity).catch(() => false)
    if (took) return
    // The Studio went away or refused: look again next time instead of trusting the old finding.
    forget()
    if (warned.has(note.port)) return
    warned.add(note.port)
    warn(`copperflow mcp: the Studio at 127.0.0.1:${note.port} did not take the agent's activity; the tools go on without it`)
  }

  const drain = async () => {
    while (waiting !== undefined) {
      const next = waiting
      waiting = undefined
      await sendOne(next)
    }
    sending = undefined
  }

  return {
    present: async () => (await lookup()) !== undefined,
    tell: (activity) => {
      waiting = activity
      sending ??= drain()
    },
    settled: async () => {
      while (sending !== undefined) await sending
    },
  }
}
