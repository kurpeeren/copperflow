// Place → No connect flag and Place → Junction, as plain data: what a click puts where. A no connect flag goes on the
// pin end nearest the click and is written as the part's `noConnect` prop (src/engine/no-connect.ts); a click on a
// flagged pin takes its flag away again. A junction is a dot on the wire nearest the click, at the nearest point of
// that wire, written as a `<junction x y />` drawing on the wire's page. Each is one edit, so one history entry. Pure.
import { MAIN_PAGE } from "../../../src/engine/model.js"
import { NO_CONNECT_PROP, noConnectNames, toggleNoConnect } from "../../../src/engine/no-connect.js"
import type { Edit, PartInfo } from "../../../src/core/types.js"
import { roundPosition, type Point } from "./geometry.js"

/** The parts of the sheet the tools read: each symbol's pin ends, by pin id. */
export interface MarkSheet {
  symbols: readonly { component: string; pinEnds: Readonly<Record<string, Point>> }[]
  wires: readonly { id: string; points: readonly Point[] }[]
  pages?: readonly { name: string; wires: readonly string[] }[]
}

export interface MarkPin {
  id: string
  number: number
  names: readonly string[]
}

export interface MarkContext {
  sheet: MarkSheet
  components: readonly { id: string; pins: readonly MarkPin[] }[]
  parts: readonly Pick<PartInfo, "name" | "props" | "editable" | "readonlyReason">[]
  locked: ReadonlySet<string>
}

export type MarkResult = { edit: Edit; summary: string } | { message: string }

/** The pin end nearest `at` within `reach`, with its part. */
export function pinEndAt(sheet: MarkSheet, at: Point, reach: number): { component: string; pin: string; end: Point } | undefined {
  let best: { component: string; pin: string; end: Point; distance: number } | undefined
  for (const symbol of sheet.symbols) {
    for (const [pin, end] of Object.entries(symbol.pinEnds)) {
      const distance = Math.hypot(end.x - at.x, end.y - at.y)
      if (distance <= reach && (!best || distance < best.distance)) best = { component: symbol.component, pin, end, distance }
    }
  }
  return best && { component: best.component, pin: best.pin, end: best.end }
}

/** A click of the No connect flag tool: the flag put on (or taken off) the pin under it. */
export function noConnectClick(context: MarkContext, at: Point, reach: number): MarkResult {
  const hit = pinEndAt(context.sheet, at, reach)
  if (!hit) return { message: "Click the end of a pin to put a no connect flag on it." }
  const pin = context.components.find((component) => component.id === hit.component)?.pins.find((candidate) => candidate.id === hit.pin)
  const part = context.parts.find((candidate) => candidate.name === hit.component)
  if (!pin || !part) return { message: `${hit.pin} belongs to a part this file does not write; flag it in its own file.` }
  if (context.locked.has(part.name)) return { message: `${part.name} is locked; unlock it to change its no connect flags.` }
  if (!part.editable) return { message: `${part.name} is read-only (${part.readonlyReason ?? "written as an expression"}).` }
  const written = part.props[NO_CONNECT_PROP]
  if (written && written.literal === undefined) return { message: `${part.name}.${NO_CONNECT_PROP} is an expression (${written.source}); change it in the code.` }
  const value = toggleNoConnect(written?.literal, pin)
  const removed = noConnectNames(value).length < noConnectNames(written?.literal).length
  const summary = `${removed ? "remove the no connect flag from" : "flag no connect on"} ${hit.pin}`
  return { edit: { kind: "setProps", part: part.name, props: { [NO_CONNECT_PROP]: value } }, summary }
}

/** The point of segment a→b nearest `p`. */
function nearestOn(p: Point, a: Point, b: Point): Point {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  return { x: a.x + t * dx, y: a.y + t * dy }
}

/** The point on the wires nearest `at` within `reach`, with the wire's id. */
export function wirePointAt(sheet: MarkSheet, at: Point, reach: number): { wire: string; point: Point } | undefined {
  let best: { wire: string; point: Point; distance: number } | undefined
  for (const wire of sheet.wires) {
    for (let i = 1; i < wire.points.length; i++) {
      const point = nearestOn(at, wire.points[i - 1] as Point, wire.points[i] as Point)
      const distance = Math.hypot(point.x - at.x, point.y - at.y)
      if (distance <= reach && (!best || distance < best.distance)) best = { wire: wire.id, point, distance }
    }
  }
  return best && { wire: best.wire, point: { x: roundPosition(best.point.x), y: roundPosition(best.point.y) } }
}

/** A click of the Junction tool: a junction on the wire under it, on that wire's page. */
export function junctionClick(sheet: MarkSheet, at: Point, reach: number): MarkResult {
  const hit = wirePointAt(sheet, at, reach)
  if (!hit) return { message: "Click a wire to put a junction on it." }
  const page = sheet.pages?.find((entry) => entry.wires.includes(hit.wire))?.name
  const edit: Edit = { kind: "addDrawing", tag: "junction", props: { x: hit.point.x, y: hit.point.y }, ...(page && page !== MAIN_PAGE ? { page } : {}) }
  return { edit, summary: `add a junction at ${hit.point.x}, ${hit.point.y}` }
}
