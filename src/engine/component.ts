import { diagnostic } from "./diagnostics.js"
import { kindOf, pinSpecs, pinTypeFromAttributes } from "./kinds.js"
import type { Component, Diagnostic, Pin, Point, Side, SourceRef } from "./model.js"
import { jsonProps, PropReader, type Props } from "./read-props.js"

/**
 * What the enclosing groups and sub-sheet instances do to their children's positions: a PCB position is turned
 * counter-clockwise by `pcbRotation` degrees (an instance's pcbRotation; 0 without one), then moved by pcbX/pcbY.
 */
export interface Offset {
  pcbX: number
  pcbY: number
  schX: number
  schY: number
  pcbRotation?: number
}

export const NO_OFFSET: Offset = { pcbX: 0, pcbY: 0, schX: 0, schY: 0 }

const QUARTER_TURNS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
]

/** Cosine and sine of an angle in degrees; exact for quarter turns, so turned positions stay clean numbers. */
function turn(degrees: number): readonly [number, number] {
  const quarter = degrees / 90
  if (Number.isInteger(quarter)) return QUARTER_TURNS[((quarter % 4) + 4) % 4] as readonly [number, number]
  const radians = (degrees * Math.PI) / 180
  return [Math.cos(radians), Math.sin(radians)]
}

/** Where a PCB position written inside the offset lands on the board. */
export function pcbPoint(offset: Offset, x: number, y: number): Point {
  const [cos, sin] = turn(offset.pcbRotation ?? 0)
  return { x: x * cos - y * sin + offset.pcbX, y: x * sin + y * cos + offset.pcbY }
}

export interface PartOrigin {
  source: SourceRef
  library: string | undefined
  offset: Offset
}

export interface BuiltPart {
  component: Component
  diagnostics: Diagnostic[]
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function supplierParts(value: unknown): Record<string, string[]> {
  const entries = Object.entries(record(value) ?? {}).flatMap(([supplier, numbers]) => {
    const list = (Array.isArray(numbers) ? numbers : [numbers]).filter((n): n is string => typeof n === "string")
    return list.length > 0 ? [[supplier, list] as const] : []
  })
  return Object.fromEntries(entries)
}

function pcbPlacement(reader: PropReader, props: Props, offset: Offset): Component["pcb"] {
  const x = reader.length("pcbX")
  const y = reader.length("pcbY")
  const rotation = reader.angle("pcbRotation") ?? 0
  if (x === undefined && y === undefined) return undefined
  const at = pcbPoint(offset, x ?? 0, y ?? 0)
  const turned = (((rotation + (offset.pcbRotation ?? 0)) % 360) + 360) % 360
  return { ...at, rotation: turned, side: props["layer"] === "bottom" ? "bottom" : "top" }
}

function schPlacement(reader: PropReader, id: string, origin: PartOrigin, out: Diagnostic[]): Component["sch"] {
  const x = reader.length("schX")
  const y = reader.length("schY")
  const angle = reader.angle("schRotation") ?? 0
  const rotation = (Math.round(angle / 90) * 90) % 360
  if (angle !== rotation) {
    const message = `${id}: schRotation ${angle} was rounded to ${rotation}`
    out.push(diagnostic("bad-value", "warning", message, [`${id}.schRotation`], origin.source))
  }
  if (x === undefined && y === undefined) return undefined
  return { x: (x ?? 0) + origin.offset.schX, y: (y ?? 0) + origin.offset.schY, rotation }
}

function makePins(tag: string, id: string, props: Props, padCount: number | undefined): Pin[] {
  const attributes = record(props["pinAttributes"])
  const sources = { pinLabels: record(props["pinLabels"]), pinCount: props["pinCount"], polarized: props["polarized"] === true, padCount }
  return pinSpecs(tag, sources).map(({ number, names }) => {
    const found = names.map((name) => record(attributes?.[name])).find((value) => value !== undefined)
    return { id: `${id}.pin${number}`, component: id, number, names, type: pinTypeFromAttributes(found) }
  })
}

const SIDES: readonly string[] = ["left", "right", "top", "bottom"]

/** The sides `pinSides` ({ pin1: "left" }) names; an entry that is not a pin and a side is reported and dropped. */
function readPinSides(id: string, props: Props, source: SourceRef): { sides: Record<number, Side>; diagnostics: Diagnostic[] } {
  const sides: Record<number, Side> = {}
  const diagnostics: Diagnostic[] = []
  for (const [key, value] of Object.entries(record(props["pinSides"]) ?? {})) {
    const number = /^pin([1-9][0-9]*)$/.exec(key)?.[1]
    if (number !== undefined && typeof value === "string" && SIDES.includes(value)) sides[Number(number)] = value as Side
    else {
      const message = `${id}: pinSides.${key} must be a pin such as pin1 with one of left, right, top or bottom`
      diagnostics.push(diagnostic("bad-value", "warning", message, [`${id}.pinSides.${key}`], source))
    }
  }
  return { sides, diagnostics }
}

/** A part's footprint string, declared or implied by its kind, and how many pads it has, if known. */
export interface PartFootprint {
  name: string | undefined
  padCount: number | undefined
}

/** Builds one part. `id` is already unique. */
export function buildPart(tag: string, id: string, props: Props, origin: PartOrigin, footprint: PartFootprint): BuiltPart {
  const reader = new PropReader(props, id, origin.source)
  const diagnostics: Diagnostic[] = []
  const pcb = pcbPlacement(reader, props, origin.offset)
  const sch = schPlacement(reader, id, origin, diagnostics)
  const pins = makePins(tag, id, props, footprint.padCount)
  const pinSides = readPinSides(id, props, origin.source)
  if (pins.length === 0 && kindOf(tag)?.pins === "from-props") {
    const message = `${id} has no pins: give it pinLabels, pinCount or a footprint with known pads`
    diagnostics.push(diagnostic("unsupported-element", "error", message, [id], origin.source))
  }
  const valueProp = kindOf(tag)?.valueProp
  const rawValue = valueProp ? props[valueProp] : undefined
  const mpn = reader.string("manufacturerPartNumber")
  const component: Component = {
    id,
    kind: tag,
    ...(typeof rawValue === "string" || typeof rawValue === "number" ? { value: String(rawValue) } : {}),
    ...(footprint.name ? { footprint: footprint.name } : {}),
    ...(mpn ? { mpn } : {}),
    supplierPartNumbers: supplierParts(props["supplierPartNumbers"]),
    ...(origin.library ? { library: origin.library } : {}),
    pins,
    pinSides: pinSides.sides,
    ...(sch ? { sch } : {}),
    ...(pcb ? { pcb } : {}),
    groupOffset: { pcb: { x: origin.offset.pcbX, y: origin.offset.pcbY }, sch: { x: origin.offset.schX, y: origin.offset.schY } },
    props: jsonProps(props),
    source: origin.source,
  }
  return { component, diagnostics: [...reader.diagnostics, ...pinSides.diagnostics, ...diagnostics] }
}
