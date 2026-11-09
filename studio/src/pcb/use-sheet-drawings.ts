// The schematic's drawings on the canvas: which one is under the pointer at this zoom (drawing-hit.ts), the boxes a
// selection box takes, where a drag snaps each one, and their removal for Delete (drawing-actions.ts).
import { useCallback, useMemo } from "react"
import type { CircuitData, Design } from "../api"
import type { SchematicDrawing } from "../../../src/engine/model.js"
import type { RemoveDrawings } from "./delete-plan"
import { drawingOrigin, drawingsRemoval } from "./drawing-actions"
import { drawingAreas, drawingAt } from "./drawing-hit"
import type { Camera, Point } from "./geometry"
import type { GestureDrawings } from "./gestures"
import { WIRE_REACH_PX } from "./wire-hit"

interface SheetDrawingsInput {
  design: Design
  circuit: CircuitData
  camera: Camera | undefined
  locked: ReadonlySet<string>
}

export function useSheetDrawings({ design, circuit, camera, locked }: SheetDrawingsInput) {
  const { drawings } = design.schematic
  const drawingOf = useCallback((id: string | undefined): SchematicDrawing | undefined => (id === undefined ? undefined : drawings.find((drawing) => drawing.id === id)), [drawings])
  const hits = useMemo<GestureDrawings>(
    () => ({
      // A pointer reaches a drawing as it reaches a wire, from its line's edge.
      at: (world: Point) => (camera ? drawingAt(drawings, world, WIRE_REACH_PX / camera.scale) : undefined),
      boxes: drawingAreas(drawings),
      origin: (id: string) => {
        const drawing = drawingOf(id)
        return drawing && drawingOrigin(drawing)
      },
    }),
    [drawings, camera, drawingOf],
  )
  const removal = useCallback<RemoveDrawings>((ids) => drawingsRemoval(circuit.model, drawings, locked)(ids), [circuit.model, drawings, locked])
  return { hits, removal, drawingOf }
}
