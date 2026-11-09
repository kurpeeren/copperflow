// What Move, Rotate, Delete, Lock and Unlock do to the whole selection, as plain data: the edits for one history
// entry, the parts left out and why. A part is left out for the reason that would stop the same action on it alone.
import type { Edit } from "../../../src/core/types.js"
import { roundPosition, snap, unionBoxes, type Box, type PartBox, type Point } from "./geometry.js"
import { movedTo, nextRotation, VIEWS, ZERO, type Anchor, type SourceCircuit, type Turn, type View } from "./positions.js"

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

/** How the history names wires among other things: the one wire by its name ("the wire from R1.pin2 to R2.pin1"), or how many. */
export const wireWords = (names: readonly string[]): string[] => (names.length > 1 ? [`${names.length} wires`] : [...names])

/** "by 90°" for a counter-clockwise turn, "by -90°" for a clockwise one. */
const turnText = (turn: Turn): string => `by ${turn}°`

/** A quarter turn for every part in place, in `view`; one part keeps the summary a single rotate writes. */
export function rotateEach(circuit: SourceCircuit, names: readonly string[], view: View, blockerFor: (name: string) => string | null, turn: Turn = 90): GroupEdit {
  const { rotation, where } = VIEWS[view]
  const turned: { name: string; to: number }[] = []
  const skipped: string[] = []
  for (const name of names) {
    const blocker = blockerFor(name)
    const next = blocker ?? nextRotation(circuit, name, view, turn)
    if (typeof next === "string") skipped.push(next)
    else turned.push({ name, to: next })
  }
  const parts = turned.map((turn) => turn.name)
  const [single] = turned
  const summary = turned.length === 1 && single ? `rotate ${single.name}${where} to ${single.to}°` : `rotate ${nameList(parts)}${where} ${turnText(turn)}`
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

/** With snap off an arrow key moves a tenth of a grid step, for fine placing between the grid lines. */
export const FREE_NUDGE_DIVISOR = 10

/**
 * How far an arrow key pushes: `steps` grid steps along the unit direction, rounded like any position; with snap off
 * (`snapOn` false) a tenth of that, since the grid no longer decides where a part may sit.
 */
export function nudgeOffset(direction: { dx: number; dy: number }, step: number, steps: number, snapOn = true): Point {
  const stride = snapOn ? step : step / FREE_NUDGE_DIVISOR
  return { x: roundPosition(direction.dx * stride * steps), y: roundPosition(direction.dy * stride * steps) }
}

/** The centre of the box around the selection's parts, snapped to the grid; undefined when there are no boxes. */
export function selectionCentre(boxes: readonly Box[], step: number): Point | undefined {
  const bounds = unionBoxes(boxes)
  return bounds ? { x: snap((bounds.minX + bounds.maxX) / 2, step), y: snap((bounds.minY + bounds.maxY) / 2, step) } : undefined
}

/** Where a point goes when turned a quarter about `centre` (y up): counter-clockwise for 90, clockwise for -90. */
export function turnedAbout(point: Point, centre: Point, turn: Turn = 90): Point {
  const sign = turn > 0 ? 1 : -1
  return { x: centre.x - sign * (point.y - centre.y), y: centre.y + sign * (point.x - centre.x) }
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
  placed: (name: string) => boolean = () => true,
  turn: Turn = 90,
): GroupEdit {
  if (names.length === 1) return rotateEach(circuit, names, view, blockerFor, turn)
  const { rotation, position, where } = VIEWS[view]
  const edits: Edit[] = []
  const parts: string[] = []
  const skipped: string[] = []
  for (const name of names) {
    if (!placed(name)) {
      skipped.push(`${name} is not in this view`)
      continue
    }
    const next = blockerFor(name) ?? nextRotation(circuit, name, view, turn)
    if (typeof next === "string") {
      skipped.push(next)
      continue
    }
    const anchor = anchorOf(name)
    const from = anchor.origin
    const to = turnedAbout(from, centre, turn)
    const [x, y] = movedTo(circuit, name, view, anchor, { x: to.x - from.x, y: to.y - from.y })
    edits.push({ kind: "setProps", part: name, props: { [position[0]]: x, [position[1]]: y, [rotation]: next } })
    parts.push(name)
  }
  return { edits, summary: `rotate ${nameList(parts)}${where} ${turnText(turn)}`, parts, skipped, done: "rotated" }
}

/** Where the parts sit in the open view and its Grid step. */
export interface Layout {
  anchors: ReadonlyMap<string, Anchor>
  boxes: readonly PartBox[]
  step: number
  /** Whether snap is on (View → Snap); absent means on. */
  snap?: boolean
}

/** Whether the open view draws the part: it has a box or an anchor there. */
export function inView(layout: Pick<Layout, "anchors" | "boxes">): (name: string) => boolean {
  const shown = new Set(layout.boxes.map((part) => part.name))
  return (name) => shown.has(name) || layout.anchors.has(name)
}

/** What Rotate (counter-clockwise) or Rotate right (turn -90) does to the selection: the edit, or a message when no selected part is in this view. */
export function rotatePlan(
  circuit: SourceCircuit,
  names: readonly string[],
  view: View,
  layout: Layout,
  blockerFor: (name: string) => string | null,
  turn: Turn = 90,
): GroupEdit | { message: string } {
  if (names.length === 1) return rotateEach(circuit, names, view, blockerFor, turn)
  const centre = selectionCentre(layout.boxes.filter((part) => names.includes(part.name)).map((part) => part.box), layout.step)
  if (!centre) return { message: "None of the selected parts is in this view." }
  return rotateAbout(circuit, names, view, anchorLookup(layout.anchors, layout.boxes), centre, blockerFor, inView(layout), turn)
}

/**
 * What an arrow key does to the selection: every part the open view draws moves by `offset`, as a drag does; a part
 * the view does not draw is left out and named, so it is not moved from the origin.
 */
export function nudgePlan(
  circuit: SourceCircuit,
  names: readonly string[],
  view: View,
  layout: Pick<Layout, "anchors" | "boxes">,
  offset: Point,
  blockerFor: (name: string) => string | null,
): GroupEdit {
  const placed = inView(layout)
  const away = names.filter((name) => !placed(name)).map((name) => `${name} is not in this view`)
  const plan = moveEach(circuit, names.filter(placed), view, anchorLookup(layout.anchors, layout.boxes), offset, blockerFor)
  return { ...plan, skipped: [...away, ...plan.skipped] }
}

/** One removePart edit for every part that may go. */
export function removeEach(names: readonly string[], blockerFor: (name: string) => string | null): GroupEdit {
  const skipped = names.flatMap((name) => blockerFor(name) ?? [])
  const parts = names.filter((name) => blockerFor(name) === null)
  return { edits: parts.map((name) => ({ kind: "removePart", part: name })), summary: `remove ${nameList(parts)}`, parts, skipped, done: "removed" }
}

/** The question asked before the parts are removed, and the `wires` removed with them when there are any. */
export function removeQuestion(parts: readonly string[], wires = 0): string {
  const these = parts.length === 1 ? `${parts[0]} and its connections` : `${parts.length} parts (${nameList(parts)}) and their connections`
  return wires === 0 ? `Remove ${these}?` : `Remove ${these}, and ${wires} ${wires === 1 ? "wire" : "wires"}?`
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
  /** Like edit, with the server's write mark; the key session needs it to order its edits against builds. */
  editMarked?(edits: Edit[], summary: string): Promise<{ ok: boolean; mark?: number }>
  notify(text: string): void
}

/**
 * Sends the plan's edits as one change. The parts left out are named once the edit has gone through, so a failure's
 * own message is not covered by them; with nothing to send, only the reasons are given. Resolves to whether it sent.
 */
export async function sendGroupEdit(plan: GroupEdit, actions: GroupEditActions): Promise<boolean> {
  return (await sendGroupEditMarked(plan, actions)).ok
}

/** Like sendGroupEdit, and also the server's mark of the write when the actions give it. */
export async function sendGroupEditMarked(plan: GroupEdit, actions: GroupEditActions): Promise<{ ok: boolean; mark?: number }> {
  const note = skippedNote(plan)
  if (plan.edits.length === 0) {
    if (note) actions.notify(note)
    return { ok: false }
  }
  const outcome = actions.editMarked ? await actions.editMarked(plan.edits, plan.summary) : { ok: await actions.edit(plan.edits, plan.summary) }
  if (outcome.ok && note) actions.notify(note)
  return outcome
}
