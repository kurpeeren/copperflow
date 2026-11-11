// Where the pointer last was on each canvas, in world units, so Edit → Paste can land the copy there as EasyEDA does.
// The canvases note it as the pointer moves and forget it when it leaves. Plain TypeScript.
import type { Point } from "../pcb/geometry.js"

export type PointerView = "sch" | "pcb"

const last: Partial<Record<PointerView, Point>> = {}

export function notePointer(view: PointerView, at: Point | undefined): void {
  if (at) last[view] = at
  else delete last[view]
}

export function lastPointer(view: PointerView): Point | undefined {
  return last[view]
}
