// What Rotate, Delete, Lock and Unlock do to the whole selection, as plain data: the edits for one history entry, the
// parts left out and why. A part is left out for the reason that would stop the same action on it alone.
import type { Edit } from "../../../src/core/types.js"
import { nextRotation, VIEWS, type SourceCircuit, type View } from "./positions.js"

/** One change for several parts. */
export interface GroupEdit {
  /** Sent together, so they are one entry in the history. */
  edits: Edit[]
  summary: string
  /** The parts the edits change. */
  parts: string[]
  /** Why each part left out was left out, e.g. "R1 is locked". */
  skipped: string[]
}

/** How many names a message spells out before it counts the rest. */
const NAMES_SHOWN = 3

/** "R1", "R1 and R2", "R1, R2 and C1", "R1, R2, C1 and 2 more". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  if (names.length > NAMES_SHOWN) return `${names.slice(0, NAMES_SHOWN).join(", ")} and ${names.length - NAMES_SHOWN} more`
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}

/** A quarter turn for every part in place, in `view`; one part keeps the summary a single rotate writes. */
export function rotateEach(circuit: SourceCircuit, names: readonly string[], view: View, blockerFor: (name: string) => string | null): GroupEdit {
  const { rotation, where } = VIEWS[view]
  const turned: { name: string; to: number }[] = []
  const skipped: string[] = []
  for (const name of names) {
    const blocker = blockerFor(name)
    const next = blocker ?? nextRotation(circuit, name, view)
    if (typeof next === "string") skipped.push(next)
    else turned.push({ name, to: next })
  }
  const parts = turned.map((turn) => turn.name)
  const [single] = turned
  const summary = turned.length === 1 && single ? `rotate ${single.name}${where} to ${single.to}°` : `rotate ${nameList(parts)}${where} by 90°`
  return { edits: turned.map((turn) => ({ kind: "setProps", part: turn.name, props: { [rotation]: turn.to } })), summary, parts, skipped }
}

/** One removePart edit for every part that may go. */
export function removeEach(names: readonly string[], blockerFor: (name: string) => string | null): GroupEdit {
  const skipped = names.flatMap((name) => blockerFor(name) ?? [])
  const parts = names.filter((name) => blockerFor(name) === null)
  return { edits: parts.map((name) => ({ kind: "removePart", part: name })), summary: `remove ${nameList(parts)}`, parts, skipped }
}

/** The question asked before the parts are removed. */
export function removeQuestion(parts: readonly string[]): string {
  return parts.length === 1 ? `Remove ${parts[0]} and its connections?` : `Remove ${parts.length} parts (${nameList(parts)}) and their connections?`
}

/** What to tell about the parts left out: the reason alone when nothing was done (as for one part), else which were skipped. */
export function skippedNote(plan: GroupEdit): string | undefined {
  if (plan.skipped.length === 0) return undefined
  const reasons = plan.skipped.join("; ")
  return plan.edits.length === 0 ? reasons : `Skipped: ${reasons}`
}

/**
 * The parts Lock (on) or Unlock (off) changes, or what to say when it changes none. Lock takes the unlocked parts and
 * the locked ones changed outside the editor (`violated`): locking those again takes their new props as the lock, which
 * is how the banner's outside change is accepted.
 */
export function lockChange(
  names: readonly string[],
  locked: ReadonlySet<string>,
  on: boolean,
  violated: ReadonlySet<string> = new Set(),
): { parts: string[] } | { message: string } {
  if (names.length === 0) return { message: "Select a part first." }
  const parts = names.filter((name) => (on ? !locked.has(name) || violated.has(name) : locked.has(name)))
  if (parts.length > 0) return { parts }
  const verb = names.length === 1 ? "is" : "are"
  return { message: `${nameList(names)} ${verb} ${on ? "already locked" : "not locked"}.` }
}

/** What sending a group edit needs: Studio's `actions.edit`, which reports its own failure, and the toast. */
export interface GroupEditActions {
  edit(edits: Edit[], summary: string): Promise<boolean>
  notify(text: string): void
}

/**
 * Sends the plan's edits as one change. The parts left out are named once the edit has gone through, so a failure's
 * own message is not covered by them; with nothing to send, only the reasons are given. Resolves to whether it sent.
 */
export async function sendGroupEdit(plan: GroupEdit, actions: GroupEditActions): Promise<boolean> {
  const note = skippedNote(plan)
  if (plan.edits.length === 0) {
    if (note) actions.notify(note)
    return false
  }
  const ok = await actions.edit(plan.edits, plan.summary)
  if (ok && note) actions.notify(note)
  return ok
}
