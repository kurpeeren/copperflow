// What Move, Rotate, Delete, Lock and Unlock do to the whole selection, as plain data: the edits for one history
// entry, the parts left out and why. A part is left out for the reason that would stop the same action on it alone.
import type { Edit } from "../../../src/core/types.js"
import { roundPosition, snap, unionBoxes, type Box, type PartBox, type Point } from "./geometry.js"
import { movedTo, nextRotation, VIEWS, ZERO, type Anchor, type SourceCircuit, type View } from "./positions.js"

/** One change for several parts. */
export interface GroupEdit {
  /** Sent together, so they are one entry in the history. */
  edits: Edit[]
  summary: string
  /** The parts the edits change. */
  parts: string[]
  /** Why each part left out was left out, e.g. "R1 is locked". */
  skipped: string[]
  /** What was done to the others, for the note about those left out: "Not moved: R2 is locked". */
  done: "moved" | "rotated" | "removed"
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
  return { edits: turned.map((turn) => ({ kind: "setProps", part: turn.name, props: { [rotation]: turn.to } })), summary, parts, skipped, done: "rotated" }
}

/**
 * Every part that may move, moved by the same `offset` in `view`, so the group keeps its shape; one part keeps the
 * summary a single drag writes. `anchorOf` says where each part sits and what its groups add.
 */
export function moveEach(
  circuit: SourceCircuit,
  names: readonly string[],
  view: View,
  anchorOf: (name: string) => Pick<Anchor, "origin" | "group">,
  offset: Point,
  blockerFor: (name: string) => string | null,
): GroupEdit {
  const [keyX, keyY] = VIEWS[view].position
  const { where } = VIEWS[view]
  const skipped = names.flatMap((name) => blockerFor(name) ?? [])
  const parts = names.filter((name) => blockerFor(name) === null)
  const moves = parts.map((name) => ({ name, to: movedTo(circuit, name, view, anchorOf(name), offset) }))
  const [single] = moves
  const summary =
    moves.length === 1 && single
      ? `move ${single.name}${where} to (${single.to[0]}, ${single.to[1]})`
      : `move ${nameList(parts)}${where} by (${roundPosition(offset.x)}, ${roundPosition(offset.y)})`
  return { edits: moves.map(({ name, to }) => ({ kind: "setProps", part: name, props: { [keyX]: to[0], [keyY]: to[1] } })), summary, parts, skipped, done: "moved" }
}

/** Where each part sits, for moves: its anchor in the view, else the centre of its box with no group offset. */
export function anchorLookup(anchors: ReadonlyMap<string, Anchor>, boxes: readonly PartBox[]): (name: string) => Pick<Anchor, "origin" | "group"> {
  return (name) => anchors.get(name) ?? { origin: boxes.find((box) => box.name === name)?.center ?? ZERO, group: ZERO }
}

/** How far an arrow key pushes: `steps` grid steps along the unit direction, rounded like any position. */
export function nudgeOffset(direction: { dx: number; dy: number }, step: number, steps: number): Point {
  return { x: roundPosition(direction.dx * step * steps), y: roundPosition(direction.dy * step * steps) }
}

/** The centre of the box around the selection's parts, snapped to the grid; undefined when there are no boxes. */
export function selectionCentre(boxes: readonly Box[], step: number): Point | undefined {
  const bounds = unionBoxes(boxes)
  return bounds ? { x: snap((bounds.minX + bounds.maxX) / 2, step), y: snap((bounds.minY + bounds.maxY) / 2, step) } : undefined
}

/** Where a point goes when turned 90 degrees counter-clockwise (y up) about `centre`. */
export function turnedAbout(point: Point, centre: Point): Point {
  return { x: centre.x - (point.y - centre.y), y: centre.y + (point.x - centre.x) }
}

/**
 * A quarter turn counter-clockwise for the whole selection about `centre`: every part that may turn moves round the
 * centre and adds 90 degrees to its rotation, so the group keeps its shape. One part turns in place, as rotateEach does.
 */
export function rotateAbout(
  circuit: SourceCircuit,
  names: readonly string[],
  view: View,
  anchorOf: (name: string) => Pick<Anchor, "origin" | "group">,
  centre: Point,
  blockerFor: (name: string) => string | null,
): GroupEdit {
  if (names.length === 1) return rotateEach(circuit, names, view, blockerFor)
  const { rotation, position, where } = VIEWS[view]
  const edits: Edit[] = []
  const parts: string[] = []
  const skipped: string[] = []
  for (const name of names) {
    const next = blockerFor(name) ?? nextRotation(circuit, name, view)
    if (typeof next === "string") {
      skipped.push(next)
      continue
    }
    const anchor = anchorOf(name)
    const from = anchor.origin
    const to = turnedAbout(from, centre)
    const [x, y] = movedTo(circuit, name, view, anchor, { x: to.x - from.x, y: to.y - from.y })
    edits.push({ kind: "setProps", part: name, props: { [position[0]]: x, [position[1]]: y, [rotation]: next } })
    parts.push(name)
  }
  return { edits, summary: `rotate ${nameList(parts)}${where} by 90°`, parts, skipped, done: "rotated" }
}

/** One removePart edit for every part that may go. */
export function removeEach(names: readonly string[], blockerFor: (name: string) => string | null): GroupEdit {
  const skipped = names.flatMap((name) => blockerFor(name) ?? [])
  const parts = names.filter((name) => blockerFor(name) === null)
  return { edits: parts.map((name) => ({ kind: "removePart", part: name })), summary: `remove ${nameList(parts)}`, parts, skipped, done: "removed" }
}

/** The question asked before the parts are removed. */
export function removeQuestion(parts: readonly string[]): string {
  return parts.length === 1 ? `Remove ${parts[0]} and its connections?` : `Remove ${parts.length} parts (${nameList(parts)}) and their connections?`
}

/** What to tell about the parts left out: the reason alone when nothing was done (as for one part), else what was not done to which. */
export function skippedNote(plan: GroupEdit): string | undefined {
  if (plan.skipped.length === 0) return undefined
  const reasons = plan.skipped.join("; ")
  return plan.edits.length === 0 ? reasons : `Not ${plan.done}: ${reasons}`
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
