// What the schematic draws of a move while its build has not landed: the parts where their new props put them, the
// wires in the shapes the move gives them (wire-follow.ts withMovedWires), so the wires stay on the pins, and the labels
// those take along. For the arrow keys the parts' places are kept on the sheet itself, not as an offset, so a build of
// an earlier press that lands meanwhile does not move them twice. Pure; use-key-edits.ts keeps the latest arrow move
// until its build lands, and the canvas draws a drag's the same way.
import type { Design } from "../../../src/engine/design.js"
import type { NetLabel } from "../../../src/engine/schematic.js"
import { roundPosition, type Point } from "./geometry.js"
import type { GroupEdit } from "./group-edits.js"
import { sideOf } from "./label-drag.js"
import { ZERO, type Anchor } from "./positions.js"
import type { WireLine } from "./wire-hit.js"

/** A move waiting for its build: where each moved part's origin goes on the sheet, and the wires' new shapes. */
export interface MovePreview {
  parts: { name: string; to: Point }[]
  wires: readonly WireLine[]
}

/** A move as the canvas draws it: the parts shifted by one offset, and the wires' new shapes. */
export interface MoveShown {
  names: readonly string[]
  offset: Point
  wires?: readonly WireLine[]
}

/** The preview of a move's plan on the schematic: each part's new schX and schY plus its groups' offset, and the wires' shapes. */
export function movePreview(design: Design, plan: GroupEdit, wires: readonly WireLine[]): MovePreview {
  const parts = plan.edits.flatMap((edit) => {
    if (edit.kind !== "setProps") return []
    const { schX, schY } = edit.props
    if (typeof schX !== "number" || typeof schY !== "number") return []
    const group = design.circuit.components.find((component) => component.id === edit.part)?.groupOffset.sch ?? ZERO
    return [{ name: edit.part, to: { x: roundPosition(schX + group.x), y: roundPosition(schY + group.y) } }]
  })
  return { parts, wires }
}

/** The preview as the canvas draws a move: the parts shifted from where the sheet has them now (the move is one offset for all), and the wires. */
export function previewMoving(preview: MovePreview, anchors: ReadonlyMap<string, Pick<Anchor, "origin">>): MoveShown & { names: string[] } {
  const placed = preview.parts.find((part) => anchors.has(part.name))
  const from = placed && anchors.get(placed.name)?.origin
  const offset = placed && from ? { x: roundPosition(placed.to.x - from.x), y: roundPosition(placed.to.y - from.y) } : ZERO
  return { names: preview.parts.map((part) => part.name), offset, wires: preview.wires }
}

const spot = (p: Point): string => `${p.x},${p.y}`

/** Where a label goes with the move: at the end of its wire's new shape, or with the moved pin it sits on; undefined when it stays. */
function labelPlace(label: NetLabel, wireEnds: ReadonlyMap<string, readonly Point[]>, movedPins: ReadonlySet<string>, offset: Point): Pick<NetLabel, "at" | "side"> | undefined {
  const points = wireEnds.get(label.id)
  const end = points?.[points.length - 1]
  if (points && end) return end.x === label.at.x && end.y === label.at.y ? undefined : { at: end, side: sideOf(points[points.length - 2], end) }
  const moves = movedPins.has(spot(label.at)) && (offset.x !== 0 || offset.y !== 0)
  return moves ? { at: { x: roundPosition(label.at.x + offset.x), y: roundPosition(label.at.y + offset.y) }, side: label.side } : undefined
}

/**
 * The sheet's labels with those a move takes along at their new places: a label or symbol Studio puts on a pin of a
 * moved part moves with the pin, and the label at the end of a hand-drawn wire sits at the end of the wire's new shape
 * (where it stays unless it is the wire's corner next to the pin). The sheet's own list when none moves.
 */
export function labelsAfterMove(sheet: { labels: readonly NetLabel[]; symbols: readonly { component: string; pinEnds: Record<string, Point> }[] }, moving: MoveShown | undefined): readonly NetLabel[] {
  if (!moving) return sheet.labels
  const movedPins = new Set(sheet.symbols.filter((symbol) => moving.names.includes(symbol.component)).flatMap((symbol) => Object.values(symbol.pinEnds).map(spot)))
  const wireEnds = new Map((moving.wires ?? []).map((wire) => [`label:${wire.id.slice("wire:".length)}`, wire.points] as const))
  const places = sheet.labels.map((label) => labelPlace(label, wireEnds, movedPins, moving.offset))
  return places.every((place) => place === undefined) ? sheet.labels : sheet.labels.map((label, i) => ({ ...label, ...places[i] }))
}
