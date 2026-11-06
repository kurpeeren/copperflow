// The schematic's Place tools (Net label, GND, VCC): the edit a click on a pin writes, and the label as it
// will be drawn while its build is pending.
//
// A label is placed as a hand-drawn wire: an addTrace from the pin to `net.<name>` with ONE corner a little
// outward from the pin, which the engine always draws with a label or symbol at its end, even when the
// net has a single pin (the same rule label-drag.ts uses).
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import type { Edit } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import type { Pin, Side } from "../../../src/engine/model.js"
import type { NetLabel } from "../../../src/engine/schematic.js"
import { netBadge } from "../net-rows.js"
import type { Point } from "./geometry.js"
import type { SourceCircuit } from "./positions.js"
import { addressable, pinSelector } from "./wire-tool.js"

export type LabelTool = "label" | "gnd" | "vcc"
export type PlaceLabel = Edit[] | { blocked: string }

/** Where the corner goes, in sheet units out from the pin end. */
export const CORNER_REACH = 0.5
const GRID = 0.1
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
export const NAME_RULE = "Use letters, digits and _, starting with a letter or _"
const SIDES: readonly Side[] = ["right", "top", "left", "bottom"]
const OUTWARD: Record<Side, Point> = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, top: { x: 0, y: 1 }, bottom: { x: 0, y: -1 } }

const round = (value: number): number => Math.round(value * 1000) / 1000 || 0
const onGrid = (value: number): number => round(Math.round(value / GRID) * GRID)

/** The net name a tool writes: GND is always GND, VCC is VCC unless another name was typed, a label takes what was typed. */
export function labelNameFor(tool: LabelTool, typed: string): string {
  if (tool === "gnd") return "GND"
  const name = typed.trim()
  return tool === "vcc" && name === "" ? "VCC" : name
}

/** Where a pin ends on the sheet, the way it faces after the part's rotation, and the corner out from it. */
function cornerOf(design: Design, pin: Pin): { end: Point; side: Side; corner: Point } | undefined {
  const placed = design.schematic.symbols.find((symbol) => symbol.pinEnds[pin.id])
  const end = placed?.pinEnds[pin.id]
  const facing = placed?.symbol.pins.find((candidate) => candidate.number === pin.number)?.side
  if (!placed || !end || !facing) return undefined
  const turns = Math.round((((placed.rotation % 360) + 360) % 360) / 90) % 4
  const side = SIDES[(SIDES.indexOf(facing) + turns) % 4] ?? facing
  const out = OUTWARD[side]
  return { end, side, corner: { x: onGrid(end.x + out.x * CORNER_REACH), y: onGrid(end.y + out.y * CORNER_REACH) } }
}

const pinById = (design: Design, id: string): Pin | undefined => design.circuit.components.flatMap((component) => component.pins).find((pin) => pin.id === id)

const netOfPin = (design: Design, pinId: string) => design.circuit.nets.find((net) => net.pins.includes(pinId))

/** Why `name` cannot be a net name, or undefined when it can. */
export function nameProblem(name: string): string | undefined {
  if (name === "") return "Name the net label"
  return NAME.test(name) ? undefined : NAME_RULE
}

/** Why the tool may not be placed on `pin` with `name`, or undefined when it may. */
function blocker(design: Design, pin: Pin, name: string, locked: ReadonlySet<string>): string | undefined {
  const selector = pinSelector(design, pin)
  const problem = nameProblem(name)
  if (problem) return problem
  if (!addressable(selector)) return `${selector} has a repeated name and cannot be wired from the Studio`
  if (locked.has(pin.component)) return `${pin.component} is locked`
  if (netOfPin(design, pin.id)?.names.includes(name)) return `${selector} is already on ${name}`
  return undefined
}

/**
 * The edit that puts `tool` on `pin` (a pin id such as `R1.pin2`), or why it cannot. `locked` are the
 * locked parts; the source model is the Studio's view of the code, kept in the signature with the
 * other edit helpers (a new trace needs nothing from it today).
 */
export function placeLabelEdits(design: Design, _source: SourceCircuit, tool: LabelTool, typed: string, pinId: string, locked: ReadonlySet<string>): PlaceLabel {
  const pin = pinById(design, pinId)
  const spot = pin && cornerOf(design, pin)
  if (!pin || !spot) return { blocked: "No pin there" }
  const name = labelNameFor(tool, typed)
  const why = blocker(design, pin, name, locked)
  if (why) return { blocked: why }
  return [{ kind: "addTrace", from: pinSelector(design, pin), to: `net.${name}`, schematicRouteHints: [spot.corner] }]
}

export function placeSummary(tool: LabelTool, name: string, pinId: string): string {
  return tool === "label" ? `Add ${name} label at ${pinId}` : `Add ${name} at ${pinId}`
}

/** A label that has been sent and waits for its build: the wire to it, and the label as the layout will have it. */
export interface PendingLabel {
  wire: Point[]
  label: NetLabel
}

export function pendingLabel(design: Design, tool: LabelTool, typed: string, pinId: string): PendingLabel | undefined {
  const pin = pinById(design, pinId)
  const spot = pin && cornerOf(design, pin)
  if (!pin || !spot) return undefined
  const name = labelNameFor(tool, typed)
  const style = netBadge([name]) ?? "label"
  return { wire: [spot.end, spot.corner], label: { id: `label:pending:${pinId}:${name}`, net: `net.${name}`, text: name, at: spot.corner, side: spot.side, style } }
}

/** The other named net `pin` is on, which placing `name` there would join to it; the Studio asks first. */
export function joinedNet(design: Design, pinId: string, name: string): string | undefined {
  const net = netOfPin(design, pinId)
  return net && !net.names.includes(name) ? net.names[0] : undefined
}
