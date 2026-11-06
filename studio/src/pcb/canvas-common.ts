// What the PCB and schematic canvases share: their props, size, camera, pointer position, the
// background and the editor layer drawn over the circuit.
import { useCallback, useEffect, useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from "react"
import type { Annotations, CircuitData, Design } from "../api"
import type { Actions } from "../App"
import { drawGrid, drawLockBadge, drawMark, drawOutline, drawSelectionBox } from "./overlays"
import { fitCamera, zoomAt, type Box, type Camera, type PartBox, type Point, type Size } from "./geometry"
import { pcbBoxes } from "./pcb-draw"
import { moveBlocker, partAnchors, type View } from "./positions"
import type { Unit } from "./units"
import { sheetBoxes } from "./schematic-draw"

export interface CanvasProps {
  design: Design
  /** Changes when a build finishes. */
  buildId: string | undefined
  /** When the build behind the shown design started (ms); a preview sent before then is in the design. */
  builtFrom: number
  circuit: CircuitData
  actions: Actions
  selected: string | null
  onSelect(name: string | null): void
  /** The highlighted net's id, shared by both views. */
  highlight: string | null
  onHighlight(net: string | null): void
  /** The PCB's display unit; the model stays in mm. */
  unit: Unit
  onToggleUnit(): void
}

/** A part drawn away from where the design has it: being dragged, or moved and waiting for its build. */
export interface Moving {
  name: string
  offset: Point
}

const WHEEL_ZOOM = 0.0015

/** The parts of one view: their boxes and anchors, whether any is auto-placed, the locks, and why a part may not move. */
export function usePlacedParts(design: Design, view: View, circuit: CircuitData) {
  const boxes = useMemo(() => (view === "pcb" ? pcbBoxes(design.pcb) : sheetBoxes(design.schematic)), [design, view])
  const anchors = useMemo(() => partAnchors(design, view), [design, view])
  const autoPlaced = useMemo(() => [...anchors.values()].some((anchor) => anchor.autoPlaced), [anchors])
  const locked = useMemo(() => new Set(circuit.annotations.locks.map((l) => l.part)), [circuit])
  const blockerFor = useCallback((name: string) => moveBlocker(circuit, locked, name, view), [circuit, locked, view])
  return { boxes, anchors, autoPlaced, locked, blockerFor }
}

/** Follows the element's size in whole CSS pixels. */
export function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/**
 * A pointer position in the element's own CSS pixels. Browser zoom or a scaled page can make the
 * on-screen rectangle differ from the layout size, so the offset is divided by that ratio.
 */
export function toLocal(element: Element | null, size: Size, event: { clientX: number; clientY: number }): Point {
  const rect = element?.getBoundingClientRect()
  if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 }
  return { x: ((event.clientX - rect.left) * size.width) / rect.width, y: ((event.clientY - rect.top) * size.height) / rect.height }
}

/** The camera: it fits `bounds` until the person moves it, and zooms around the pointer on the wheel. */
export function useCamera(ref: RefObject<HTMLElement | null>, size: Size, bounds: Box | undefined, margin?: number) {
  const [camera, setCamera] = useState<Camera>()
  useWheelZoom(ref, size, setCamera)
  const fit = useCallback(() => {
    if (bounds && size.width > 0) setCamera(fitCamera(bounds, size, margin))
  }, [bounds, size, margin])
  useEffect(() => {
    if (!camera) fit()
  }, [camera, fit])
  return { camera, setCamera, fit }
}

/** React's onWheel is passive, so preventDefault needs a native listener. */
function useWheelZoom(ref: RefObject<HTMLElement | null>, size: Size, setCamera: Dispatch<SetStateAction<Camera | undefined>>): void {
  const onWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault()
      const point = toLocal(ref.current, size, event)
      setCamera((current) => (current ? zoomAt(current, size, point, Math.exp(-event.deltaY * WHEEL_ZOOM)) : current))
    },
    [ref, size, setCamera],
  )
  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.addEventListener("wheel", onWheel, { passive: false })
    return () => element.removeEventListener("wheel", onWheel)
  }, [ref, onWheel])
}

/** Sizes the canvas to the device resolution and paints the background and grid; null when there is nothing to draw on. */
export function prepareCanvas(
  canvas: HTMLCanvasElement | null,
  size: Size,
  camera: Camera,
  background: string,
): { ctx: CanvasRenderingContext2D; ratio: number } | null {
  if (!canvas || size.width === 0) return null
  const ratio = window.devicePixelRatio || 1
  canvas.width = size.width * ratio
  canvas.height = size.height * ratio
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = background
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  drawGrid(ctx, camera, size)
  return { ctx, ratio }
}

export interface EditorLayer {
  view: View
  boxes: PartBox[]
  moving: Moving | undefined
  /** The part under the pointer, when its hover outline should show. */
  hover: string | undefined
  selected: string | null
  locked: ReadonlySet<string>
  marks: Annotations["marks"]
  /** The note box being drawn, in screen pixels. */
  noteBox: { start: Point; current: Point } | undefined
}

/** Hover and selection outlines, lock badges, the view's notes and the note box, in CSS pixels. */
export function drawEditorLayer(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, layer: EditorLayer): void {
  for (const part of layer.boxes) {
    const offset = layer.moving && part.name === layer.moving.name ? layer.moving.offset : { x: 0, y: 0 }
    if (part.name === layer.hover && part.name !== layer.selected) drawOutline(ctx, camera, size, part.box, offset, "hover")
    if (part.name === layer.selected) drawOutline(ctx, camera, size, part.box, offset, "selected")
    if (layer.locked.has(part.name)) drawLockBadge(ctx, camera, size, part.box)
  }
  for (const mark of layer.marks) {
    if (mark.view === layer.view && mark.x !== undefined && mark.y !== undefined) drawMark(ctx, camera, size, { x: mark.x, y: mark.y }, mark.id, mark.text)
  }
  if (layer.noteBox) drawSelectionBox(ctx, layer.noteBox.start, layer.noteBox.current)
}

/** A key meant for the canvas: not typed into a field, and not a browser shortcut such as Ctrl+R. */
export function isCanvasKey(event: KeyboardEvent): boolean {
  if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return false
  return !(event.ctrlKey || event.metaKey || event.altKey)
}
