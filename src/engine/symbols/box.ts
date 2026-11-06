import type { Component, Pin, Side } from "../model.js"
import { CHAR_WIDTH, clean, line, polygon, pt, text, TEXT_SIZE, type Drawing, type PinPlace, type Shape } from "./types.js"

const PIN_PITCH = 0.2
const PIN_LENGTH = 0.2
const MIN_WIDTH = 1.0
const MIN_HEIGHT = 0.6
const NAME_PADDING = 0.4
/** Room between the box edge and the start of a pin name. */
const NAME_GAP = 0.05
const NUMBER_RISE = 0.07

type Placed = { pin: Pin; side: Side }

/** The side a pin type goes to when nothing says otherwise. */
function defaultSide(pin: Pin): Side {
  if (pin.type === "power_in") return "top"
  if (pin.type === "ground") return "bottom"
  if (pin.type === "output" || pin.type === "power_out") return "right"
  return "left"
}

export const pinLabel = (pin: Pin): string => pin.names[1] ?? pin.names[0] ?? `pin${pin.number}`

const group = (placed: Placed[], side: Side): Pin[] =>
  placed.filter((p) => p.side === side).map((p) => p.pin).sort((a, b) => a.number - b.number)

const nameWidth = (pins: Pin[]): number => Math.max(0, ...pins.map((pin) => pinLabel(pin).length)) * CHAR_WIDTH * TEXT_SIZE["pin-name"]

/** Rounds up to a multiple of 0.2, ignoring floating-point noise. */
const roundUp = (value: number): number => clean(Math.ceil(value / PIN_PITCH - 1e-9) * PIN_PITCH)

/** Positions centred on zero, 0.2 apart. */
const spread = (count: number): number[] => Array.from({ length: count }, (_, i) => clean((i - (count - 1) / 2) * PIN_PITCH))

interface Geometry {
  halfWidth: number
  halfHeight: number
}

function geometry(columns: Record<Side, Pin[]>): Geometry {
  const text = nameWidth(columns.left) + nameWidth(columns.right) + NAME_PADDING
  const across = Math.max(columns.top.length, columns.bottom.length) * PIN_PITCH
  const down = Math.max(columns.left.length, columns.right.length) * PIN_PITCH
  return { halfWidth: roundUp(Math.max(text, MIN_WIDTH, across)) / 2, halfHeight: roundUp(Math.max(down, MIN_HEIGHT)) / 2 }
}

/** Where a pin ends and where its lead meets the box. */
function pinPoints(side: Side, along: number, { halfWidth, halfHeight }: Geometry): { edge: [number, number]; end: [number, number] } {
  if (side === "left") return { edge: [-halfWidth, along], end: [-halfWidth - PIN_LENGTH, along] }
  if (side === "right") return { edge: [halfWidth, along], end: [halfWidth + PIN_LENGTH, along] }
  if (side === "top") return { edge: [along, halfHeight], end: [along, halfHeight + PIN_LENGTH] }
  return { edge: [along, -halfHeight], end: [along, -halfHeight - PIN_LENGTH] }
}

/** The pin name inside the box and the pin number over the lead. */
function labels(side: Side, pin: Pin, edge: [number, number], end: [number, number]): Shape[] {
  const [ex, ey] = edge
  const [nx, ny] = end
  const label = pinLabel(pin)
  const number = String(pin.number)
  if (side === "left") return [text(label, pt(ex + NAME_GAP, ey), "left", "pin-name"), text(number, pt(nx + 0.02, ny + NUMBER_RISE), "left", "pin-number")]
  if (side === "right") return [text(label, pt(ex - NAME_GAP, ey), "right", "pin-name"), text(number, pt(nx - 0.02, ny + NUMBER_RISE), "right", "pin-number")]
  const inward = side === "top" ? -1 : 1
  return [text(label, pt(ex, ey + inward * NAME_GAP * 2), "center", "pin-name"), text(number, pt(nx + 0.03, ny + inward * 0.05), "left", "pin-number")]
}

/**
 * A rectangle with the pins on its sides. A pin goes where `pinSides` says, otherwise where its type says;
 * within a side the pins run by number, from the top and from the left.
 */
export function boxDrawing(component: Component): Drawing {
  const placed = component.pins.map((pin): Placed => ({ pin, side: component.pinSides[pin.number] ?? defaultSide(pin) }))
  const columns: Record<Side, Pin[]> = {
    left: group(placed, "left"),
    right: group(placed, "right"),
    top: group(placed, "top"),
    bottom: group(placed, "bottom"),
  }
  const geo = geometry(columns)
  const shapes: Shape[] = [polygon([[-geo.halfWidth, -geo.halfHeight], [geo.halfWidth, -geo.halfHeight], [geo.halfWidth, geo.halfHeight], [-geo.halfWidth, geo.halfHeight]])]
  const places: Record<number, PinPlace> = {}
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const positions = spread(columns[side].length)
    columns[side].forEach((pin, index) => {
      const slot = positions[index] ?? 0
      const along = side === "left" || side === "right" ? -slot : slot
      const { edge, end } = pinPoints(side, along, geo)
      shapes.push(line(edge, end), ...labels(side, pin, edge, end))
      places[pin.number] = { end: pt(end[0], end[1]), side }
    })
  }
  return { shapes, places }
}
