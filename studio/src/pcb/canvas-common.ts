// What the PCB and schematic canvases share: their props, size, camera (and centring it on a
// picked check), pointer position, the background and the editor layer drawn over the circuit.
import { useCallback, useEffect, useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from "react"
import type { Annotations, CircuitData, Design } from "../api"
import type { Actions } from "../App"
import type { FocusRequest } from "../checks-panel-state"
import type { Selection, SelectionChange } from "../selection"
import type { Highlight } from "./highlight"
import type { CameraCommand } from "../shell/command-owners"
import { useCommands } from "../shell/commands"
import { drawLockBadge, drawMark, drawNoteBox, drawOutline, drawSelectionBox, type OverlayLook } from "./overlays"
import { boxMode } from "./box-select"
import type { Gesture } from "./gestures"
import type { Layout } from "./group-edits"
import { keyMenuPlace } from "./key-menu"
import type { ContextTarget } from "./press"
import { centredCamera, fitCamera, zoomAt, type Box, type Camera, type PartBox, type Point, type Size } from "./geometry"
import type { ViolationMarker } from "./markers"
import { pcbBoxes } from "./pcb-draw"
import { moveBlocker, partAnchors, type View } from "./positions"
import { fitBackingStore, resetContext } from "./canvas-surface"
import type { GridStyle } from "./grid"
import type { BuildStatus } from "./key-burst"
import type { LayerVisibility } from "./layers"
import type { Unit } from "./units"
import { sheetBoxes } from "./schematic-draw"

export interface CanvasProps {
  design: Design
  /** Changes when a build finishes. */
  buildId: string | undefined
  /** The server's build status: a failed build keeps the last design, so a Rotate waits for a build that succeeds. */
  buildStatus: BuildStatus
  /** The Studio folder's name, for the schematic's title block. */
  project: string | undefined
  /** When the build behind the shown design started (ms); a preview sent before then is in the design. */
  builtFrom: number
  circuit: CircuitData
  actions: Actions
  /** The selected parts, which both views and the panels share. */
  selection: Selection
  onSelect(change: SelectionChange): void
  /** The highlighted nets' ids, shared by both views. */
  highlight: Highlight
  onHighlight(nets: Highlight): void
  /** The PCB's display unit; the model stays in mm. */
  unit: Unit
  onToggleUnit(): void
  /** This document's grid style (lines or dots). */
  gridStyle: GridStyle
  /** This document's Grid step: the grid and the snap. */
  gridStep: number
  onGridStep(step: number): void
  /** Which PCB layers are shown (the Layer panel); the schematic has none. */
  layers: LayerVisibility
  /** This view's violations that have a position, ringed on the canvas. */
  markers: readonly ViolationMarker[]
  /** The violation picked in the DRC tab. */
  activeViolation: string | null
  /** A point to centre the camera on; the canvas calls onFocused once it has. */
  focus: FocusRequest | null
  onFocused(): void
  /** A right click that did not move, on a part, a net label or the empty canvas; `at` is in client pixels */
  onContextMenu(target: ContextTarget, at: Point): void
  /** A double click on a part: Properties, open on it. */
  onOpenProperties(part: string): void
}

/** Parts drawn away from where the design has them: being dragged, or moved and waiting for their build. */
export interface Moving {
  names: readonly string[]
  offset: Point
}

const WHEEL_ZOOM = 0.0015
/** View → Zoom in and Zoom out scale the camera by this much about the canvas centre. */
const MENU_ZOOM = 1.25

/** The parts of one view: their boxes and anchors, whether any is auto-placed, the locks, and why a part may not move. */
export function usePlacedParts(design: Design, view: View, circuit: CircuitData) {
  const boxes = useMemo(() => (view === "pcb" ? pcbBoxes(design.pcb) : sheetBoxes(design.schematic)), [design, view])
  const anchors = useMemo(() => partAnchors(design, view), [design, view])
  const autoPlaced = useMemo(() => [...anchors.values()].some((anchor) => anchor.autoPlaced), [anchors])
  const locked = useMemo(() => new Set(circuit.annotations.locks.map((l) => l.part)), [circuit])
  const blockerFor = useCallback((name: string) => moveBlocker(circuit, locked, name, view), [circuit, locked, view])
  return { boxes, anchors, autoPlaced, locked, blockerFor }
}

/** The parts' anchors and boxes with the Grid step, as one object that stays the same until one of them changes. */
export function useLayout(parts: Pick<Layout, "anchors" | "boxes">, step: number): Layout {
  const { anchors, boxes } = parts
  return useMemo(() => ({ anchors, boxes, step }), [anchors, boxes, step])
}

/** Where Shift+F10 or the menu key opens the context menu on this canvas: at the primary selected part, else the canvas centre. */
export function useKeyMenuPlace(element: RefObject<Element | null>, primary: string | undefined, boxes: readonly PartBox[], camera: Camera | undefined, size: Size) {
  return useCallback(() => {
    const rect = element.current?.getBoundingClientRect() ?? { left: 0, top: 0, width: size.width, height: size.height }
    return keyMenuPlace(primary, boxes, camera, size, rect)
  }, [element, primary, boxes, camera, size])
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
  const zoomBy = (factor: number) => () => setCamera((current) => (current ? zoomAt(current, size, { x: size.width / 2, y: size.height / 2 }, factor) : current))
  useCommands({ zoomIn: zoomBy(MENU_ZOOM), zoomOut: zoomBy(1 / MENU_ZOOM) } satisfies Record<CameraCommand, () => void>)
  return { camera, setCamera, fit }
}

/** Centres the camera on a focus request for this view, at the current zoom, as soon as the camera is ready. */
export function useCameraFocus(view: View, focus: FocusRequest | null, camera: Camera | undefined, setCamera: (camera: Camera) => void, onFocused: () => void): void {
  useEffect(() => {
    if (!focus || focus.view !== view || !camera) return
    setCamera(centredCamera(camera, focus.at))
    onFocused()
  }, [view, focus, camera, setCamera, onFocused])
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

/** Sizes the canvas to the device resolution and paints the view's background and grid; null when there is nothing to draw on. */
export function prepareCanvas(
  canvas: HTMLCanvasElement | null,
  size: Size,
  camera: Camera,
  background: string,
  grid: (ctx: CanvasRenderingContext2D, camera: Camera, size: Size) => void,
): { ctx: CanvasRenderingContext2D; ratio: number } | null {
  if (!canvas || size.width === 0) return null
  const ratio = window.devicePixelRatio || 1
  fitBackingStore(canvas, size, ratio)
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  resetContext(ctx)
  ctx.fillStyle = background
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  grid(ctx, camera, size)
  return { ctx, ratio }
}

export interface EditorLayer {
  view: View
  boxes: PartBox[]
  moving: Moving | undefined
  /** The part under the pointer, when its hover outline should show. */
  hover: string | undefined
  selection: Selection
  locked: ReadonlySet<string>
  marks: Annotations["marks"]
  /** The gesture under way, for the selection box or the note box it draws, in screen pixels. */
  gesture: Gesture | undefined
  /** The view's overlay colours: PCB_LOOK or SHEET_LOOK. */
  look: OverlayLook
}

/** Hover and selection outlines, lock badges, the view's notes, and the selection box or note box, in CSS pixels. */
export function drawEditorLayer(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, layer: EditorLayer): void {
  const { look, gesture } = layer
  for (const part of layer.boxes) {
    const offset = layer.moving?.names.includes(part.name) ? layer.moving.offset : { x: 0, y: 0 }
    const selected = layer.selection.has(part.name)
    if (part.name === layer.hover && !selected) drawOutline(ctx, camera, size, part.box, offset, "hover", look)
    if (selected) drawOutline(ctx, camera, size, part.box, offset, "selected", look)
    if (layer.locked.has(part.name)) drawLockBadge(ctx, camera, size, part.box, look)
  }
  for (const mark of layer.marks) {
    if (mark.view === layer.view && mark.x !== undefined && mark.y !== undefined) drawMark(ctx, camera, size, { at: { x: mark.x, y: mark.y }, id: mark.id, text: mark.text }, look)
  }
  if (gesture?.kind === "box") drawSelectionBox(ctx, gesture.start, gesture.current, look, boxMode(gesture.start, gesture.current))
  if (gesture?.kind === "note") drawNoteBox(ctx, gesture.start, gesture.current, look)
}

/** A key meant for the canvas: not typed into a field, and not a browser shortcut such as Ctrl+R. */
export function isCanvasKey(event: KeyboardEvent): boolean {
  if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return false
  return !(event.ctrlKey || event.metaKey || event.altKey)
}
