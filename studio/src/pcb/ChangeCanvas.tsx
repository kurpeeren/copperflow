import { useEffect, useMemo, useRef } from "react"
import type { Design } from "../api"
import type { DesignDiff } from "../../../src/engine/design-diff.js"
import type { ChangeMode } from "../change-view"
import { prepareCanvas, useElementSize } from "./canvas-common"
import { dimBoard, drawChangeLegend, drawChangeMarks } from "./change-draw"
import { PALETTE, type Ctx } from "./ctx"
import { fitCamera, pointBounds, unionBoxes, type Box, type Camera, type Point } from "./geometry"
import { drawPcb } from "./pcb-draw"

/** How much closer the view comes when a line of the change is picked. */
const FOCUS_ZOOM = 3

interface Props {
  design: Design
  diff: DesignDiff
  mode: ChangeMode
  /** The place a picked line points at; `seq` grows with each pick, so picking the same line again centres again. */
  focus?: { at: Point; seq: number }
}

function boardBox(design: Design): Box | undefined {
  const pcb = design.pcb
  return pointBounds(pcb.board?.outline ?? []) ?? unionBoxes(pcb.parts.flatMap((part) => pointBounds(part.courtyard) ?? []))
}

/** The board as the change left it (or as it was, for Before), dimmed, with the change marked over it. Nothing on it can be edited. */
export function ChangeCanvas({ design, diff, mode, focus }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const size = useElementSize(host)
  const camera = useMemo<Camera | undefined>(() => {
    const box = boardBox(design)
    if (!box || size.width === 0) return undefined
    const fit = fitCamera(box, size)
    return focus ? { cx: focus.at.x, cy: focus.at.y, scale: fit.scale * FOCUS_ZOOM } : fit
  }, [design, size, focus])
  useEffect(() => {
    if (!camera) return
    const prepared = prepareCanvas(canvas.current, size, camera, PALETTE.background, () => undefined)
    if (!prepared) return
    const ctx = prepared.ctx as unknown as Ctx
    const view = { camera, size }
    drawPcb(ctx, design.pcb, view, { ratio: prepared.ratio, copper: { tracks: design.pcb.tracks, vias: design.pcb.vias, selected: new Set() } })
    dimBoard(ctx, size)
    drawChangeMarks(ctx, view, diff, mode)
    drawChangeLegend(ctx, size, mode)
  }, [camera, size, design, diff, mode])
  return (
    <div className="change-canvas" ref={host}>
      <canvas ref={canvas} role="img" aria-label="The board with the change marked; it cannot be edited here" />
    </div>
  )
}
