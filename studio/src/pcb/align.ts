// Align and distribute: where each part of a selection goes, by its bounding box in the open view (y up). The
// layouts are pure functions of the boxes; alignPlan turns them into one group edit, with each written position
// snapped to the Grid step on the axis it moves. Locked and read-only parts, and parts the view does not draw, stay
// out of the layout and are named, so the others line up among themselves.
import { roundPosition, snap, unionBoxes, type Box, type Point } from "./geometry.js"
import { anchorLookup, inView, nameList, type GroupEdit, type Layout } from "./group-edits.js"
import { partsNeeded, type AlignCommand } from "./align-rules.js"
import { movedTo, VIEWS, type SourceCircuit, type View } from "./positions.js"

export interface Boxed {
  name: string
  box: Box
}

/** How far each part moves, by name; a part that stays is absent. */
export type Offsets = ReadonlyMap<string, Point>

const centreX = (box: Box): number => (box.minX + box.maxX) / 2
const centreY = (box: Box): number => (box.minY + box.maxY) / 2
const widthOf = (box: Box): number => box.maxX - box.minX
const heightOf = (box: Box): number => box.maxY - box.minY

/** Every part's offset along one axis, from where `target` says its box should be; zero offsets are left out. */
function shifted(parts: readonly Boxed[], axis: "x" | "y", target: (box: Box) => number, current: (box: Box) => number): Offsets {
  const offsets = new Map<string, Point>()
  for (const { name, box } of parts) {
    const delta = roundPosition(target(box) - current(box))
    if (delta !== 0) offsets.set(name, axis === "x" ? { x: delta, y: 0 } : { x: 0, y: delta })
  }
  return offsets
}

/** Equal gaps between the boxes, in the order of their near edges; the first and the last stay where they are. */
function spaced(parts: readonly Boxed[], axis: "x" | "y"): Offsets {
  const [from, to, size] = axis === "x" ? (["minX", "maxX", widthOf] as const) : (["minY", "maxY", heightOf] as const)
  const order = [...parts].sort((a, b) => a.box[from] - b.box[from] || a.name.localeCompare(b.name))
  const first = order[0]
  const last = order.at(-1)
  if (!first || !last || order.length < 3) return new Map()
  const gap = (last.box[to] - first.box[from] - order.reduce((sum, { box }) => sum + size(box), 0)) / (order.length - 1)
  const offsets = new Map<string, Point>()
  let edge = first.box[to]
  for (const { name, box } of order.slice(1, -1)) {
    const delta = roundPosition(edge + gap - box[from])
    if (delta !== 0) offsets.set(name, axis === "x" ? { x: delta, y: 0 } : { x: 0, y: delta })
    edge += gap + size(box)
  }
  return offsets
}

/** The offsets that carry out `command` on these boxes. */
export function layoutOffsets(command: AlignCommand, parts: readonly Boxed[]): Offsets {
  const bounds = unionBoxes(parts.map((part) => part.box))
  if (!bounds) return new Map()
  switch (command) {
    case "alignLeft":
      return shifted(parts, "x", () => bounds.minX, (box) => box.minX)
    case "alignRight":
      return shifted(parts, "x", () => bounds.maxX, (box) => box.maxX)
    case "alignTop":
      return shifted(parts, "y", () => bounds.maxY, (box) => box.maxY)
    case "alignBottom":
      return shifted(parts, "y", () => bounds.minY, (box) => box.minY)
    case "alignHCentres":
      return shifted(parts, "y", () => centreY(bounds), centreY)
    case "alignVCentres":
      return shifted(parts, "x", () => centreX(bounds), centreX)
    case "distributeH":
      return spaced(parts, "x")
    case "distributeV":
      return spaced(parts, "y")
  }
}

const WORDING: Record<AlignCommand, string> = {
  alignLeft: "align {} left",
  alignRight: "align {} right",
  alignTop: "align {} top",
  alignBottom: "align {} bottom",
  alignHCentres: "align {} horizontal centres",
  alignVCentres: "align {} vertical centres",
  distributeH: "distribute {} horizontally",
  distributeV: "distribute {} vertically",
}

/** "align R1, R2 and C1 left", with " in the schematic" after it there. */
export function alignSummary(command: AlignCommand, names: readonly string[], view: View): string {
  return WORDING[command].replace("{}", nameList(names)) + VIEWS[view].where
}

/** The position props that put a part `offset` away, each snapped to `step` on the axis that moves. */
function snappedTarget(circuit: SourceCircuit, name: string, view: View, layout: Layout, offset: Point): Record<string, number> {
  const [keyX, keyY] = VIEWS[view].position
  const [x, y] = movedTo(circuit, name, view, anchorLookup(layout.anchors, layout.boxes)(name), offset)
  return { [keyX]: offset.x === 0 ? x : roundPosition(snap(x, layout.step)), [keyY]: offset.y === 0 ? y : roundPosition(snap(y, layout.step)) }
}

/** What the command does to the selection: one group edit, or the reason it does nothing. */
export function alignPlan(
  circuit: SourceCircuit,
  names: readonly string[],
  view: View,
  layout: Layout,
  command: AlignCommand,
  blockerFor: (name: string) => string | null,
): GroupEdit | { message: string } {
  const placed = inView(layout)
  const skipped = names.flatMap((name) => (!placed(name) ? `${name} is not in this view` : (blockerFor(name) ?? [])))
  const movable = layout.boxes.filter((part) => names.includes(part.name) && placed(part.name) && blockerFor(part.name) === null)
  const needed = partsNeeded(command)
  if (movable.length < needed) {
    const why = skipped.length > 0 ? ` (${skipped.join("; ")})` : ""
    return { message: `${needed === 2 ? "Align" : "Distribute"} needs ${needed} or more parts that can move${why}.` }
  }
  const offsets = layoutOffsets(command, movable)
  const parts = movable.map((part) => part.name).filter((name) => offsets.has(name))
  if (parts.length === 0) return { message: skipped.length > 0 ? `Nothing moves. ${skipped.join("; ")}.` : "The parts are already there." }
  const edits = parts.map((name) => ({ kind: "setProps" as const, part: name, props: snappedTarget(circuit, name, view, layout, offsets.get(name) as Point) }))
  return { edits, summary: alignSummary(command, parts, view), parts, skipped, done: "moved" }
}
