import { useEffect, useRef } from "react"
import type { Design } from "../api"
import type { DesignDiff } from "../../../src/engine/design-diff.js"
import { changeFit, type ChangeMode } from "../change-view"
import { prepareCanvas, toLocal, useCamera, useElementSize } from "./canvas-common"
import { dimBoard, drawChangeLegend, drawChangeMarks } from "./change-draw"
import { PALETTE, type Ctx } from "./ctx"
import { centredCamera, pannedCamera, type Camera, type Point } from "./geometry"
import { drawPcb } from "./pcb-draw"

interface Props {
  design: Design
  diff: DesignDiff
  mode: ChangeMode
  /** The place a picked line points at; `seq` grows with each pick, so picking the same line again centres again. */
  focus?: { at: Point; seq: number }
}

/**
 * The board as the change left it (or as it was, for Before), dimmed, with the change marked over it. It is fitted to
 * its area when shown and when the mode changes; the wheel zooms and a drag pans as in the PCB view. Nothing is edited.
 */
export function ChangeCanvas({ design, diff, mode, focus }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const size = useElementSize(host)
  const { camera, setCamera } = useCamera(host, size, undefined)
  const pan = useRef<{ start: Point; camera: Camera } | undefined>(undefined)
  useEffect(() => {
    const fitted = changeFit(design, size)
    if (fitted) setCamera(fitted)
  }, [design, mode, size, setCamera])
  useEffect(() => {
    if (focus) setCamera((current) => (current ? centredCamera(current, focus.at) : current))
  }, [focus, setCamera])
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
  const at = (event: { clientX: number; clientY: number }) => toLocal(host.current, size, event)
  return (
    <div
      className="change-canvas"
      ref={host}
      onPointerDown={(event) => {
        if (!camera) return
        event.currentTarget.setPointerCapture(event.pointerId)
        pan.current = { start: at(event), camera }
      }}
      onPointerMove={(event) => {
        if (pan.current) setCamera(pannedCamera(pan.current.camera, pan.current.start, at(event)))
      }}
      onPointerUp={() => (pan.current = undefined)}
      onPointerCancel={() => (pan.current = undefined)}
    >
      <canvas ref={canvas} role="img" aria-label="The board with the change marked; it cannot be edited here" />
    </div>
  )
}
