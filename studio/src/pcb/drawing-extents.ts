// The box round everything the schematic draws, which decides the sheet size.
import { drawingBounds } from "../../../src/engine/drawing-kinds.js"
import type { SchematicDrawing } from "../../../src/engine/model.js"
import type { SchematicLayout } from "../../../src/engine/schematic.js"
import { pointBounds, unionBoxes, type Box } from "./geometry.js"
import { labelHitBox } from "./label-drag.js"
import { sheetTexts } from "./part-text.js"
import { sheetBoxes } from "./schematic-draw.js"

/** A drawing's shape grown by half its line width, so a thick edge stays on the sheet. A text and a bus have no line width of their own. */
function drawingBox(drawing: SchematicDrawing): Box {
  const box = drawingBounds(drawing)
  const half = "strokeWidth" in drawing ? drawing.strokeWidth / 2 : 0
  return { minX: box.minX - half, minY: box.minY - half, maxX: box.maxX + half, maxY: box.maxY + half }
}

/** Part boxes and their names and values, wire points, net labels and flags (by their hit areas), junctions and drawings; undefined for an empty schematic. */
export function drawingExtents(layout: SchematicLayout): Box | undefined {
  const boxes: Box[] = [...sheetBoxes(layout).map((part) => part.box), ...sheetTexts(layout).map((text) => text.box)]
  boxes.push(...layout.labels.map(labelHitBox), ...layout.drawings.map(drawingBox))
  const points = [...layout.wires.flatMap((wire) => wire.points), ...layout.junctions]
  const pointBox = pointBounds(points)
  if (pointBox) boxes.push(pointBox)
  return unionBoxes(boxes)
}
