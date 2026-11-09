// The box round everything the schematic draws, which decides the sheet size.
import type { SchematicLayout } from "../../../src/engine/schematic.js"
import { pointBounds, unionBoxes, type Box } from "./geometry.js"
import { labelHitBox } from "./label-drag.js"
import { sheetBoxes } from "./schematic-draw.js"

/** Part boxes, wire points, net labels and flags (by their hit areas) and junctions; undefined for an empty schematic. */
export function drawingExtents(layout: SchematicLayout): Box | undefined {
  const boxes: Box[] = sheetBoxes(layout).map((part) => part.box)
  boxes.push(...layout.labels.map(labelHitBox))
  const points = [...layout.wires.flatMap((wire) => wire.points), ...layout.junctions]
  const pointBox = pointBounds(points)
  if (pointBox) boxes.push(pointBox)
  return unionBoxes(boxes)
}
