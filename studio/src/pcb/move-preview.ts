// What the schematic draws of a move sent by the arrow keys while its build has not landed: the parts where their new
// props put them and the wires in the shapes the move gives them (wire-follow.ts withMovedWires), so the wires stay on
// the pins. The parts' places are kept on the sheet itself, not as an offset, so a build of an earlier press that lands
// meanwhile does not move them twice. Pure; use-key-edits.ts keeps the latest preview until its build lands.
import type { Design } from "../../../src/engine/design.js"
import { roundPosition, type Point } from "./geometry.js"
import type { GroupEdit } from "./group-edits.js"
import { ZERO, type Anchor } from "./positions.js"
import type { WireLine } from "./wire-hit.js"

/** A move waiting for its build: where each moved part's origin goes on the sheet, and the wires' new shapes. */
export interface MovePreview {
  parts: { name: string; to: Point }[]
  wires: readonly WireLine[]
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
export function previewMoving(preview: MovePreview, anchors: ReadonlyMap<string, Pick<Anchor, "origin">>): { names: string[]; offset: Point; wires: readonly WireLine[] } {
  const placed = preview.parts.find((part) => anchors.has(part.name))
  const from = placed && anchors.get(placed.name)?.origin
  const offset = placed && from ? { x: roundPosition(placed.to.x - from.x), y: roundPosition(placed.to.y - from.y) } : ZERO
  return { names: preview.parts.map((part) => part.name), offset, wires: preview.wires }
}
