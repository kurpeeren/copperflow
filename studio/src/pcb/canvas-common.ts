// What the PCB and schematic canvases share: their size, wheel zoom, pointer position, background
// and the rule for which parts may be moved.
import { useCallback, useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react"
import type { CircuitData } from "../api"
import { drawGrid } from "./overlays"
import { zoomAt, type Camera, type Point, type Size } from "./geometry"

const WHEEL_ZOOM = 0.0015

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

/** Zooms around the pointer. React's onWheel is passive, so preventDefault needs a native listener. */
export function useWheelZoom(ref: RefObject<HTMLElement | null>, size: Size, setCamera: Dispatch<SetStateAction<Camera | undefined>>): void {
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

/** Why a part cannot be moved or changed here, or null when it can. `keys` are its position props. */
export function moveBlocker(circuit: CircuitData, locked: ReadonlySet<string>, name: string, keys: readonly [string, string]): string | null {
  const part = circuit.model.parts.find((p) => p.name === name)
  if (!part) return "This part has no editable source element"
  if (locked.has(name)) return `${name} is locked`
  if (!part.editable) return `${name} is read-only (${part.readonlyReason})`
  const expression = keys.find((key) => part.props[key] && !part.props[key]?.editable)
  return expression ? `${name}.${expression} is an expression; change it in the code` : null
}

/** The next quarter turn of a rotation prop, or a message when the prop is not a number. */
export function nextRotation(circuit: CircuitData, name: string, key: "pcbRotation" | "schRotation"): number | string {
  const rotation = circuit.model.parts.find((p) => p.name === name)?.props[key]?.literal
  if (rotation !== undefined && typeof rotation !== "number") return `${name}.${key} is not a number`
  return ((((rotation ?? 0) as number) + 90) % 360 + 360) % 360
}

/** The prop values that move a part by `offset`: its literal plus the offset, or where it is drawn plus the offset. */
export function movedTo(circuit: CircuitData, name: string, keys: readonly [string, string], origin: Point, offset: Point): [number, number] {
  const props = circuit.model.parts.find((p) => p.name === name)?.props
  const round = (value: number) => Math.round(value * 1000) / 1000
  const target = (key: string, delta: number, absolute: number) => {
    const current = props?.[key]?.literal
    return round(typeof current === "number" ? current + delta : absolute)
  }
  return [target(keys[0], offset.x, origin.x + offset.x), target(keys[1], offset.y, origin.y + offset.y)]
}
