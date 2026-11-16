// An ASCII DXF reader for board outlines: the header's units and, from the ENTITIES section, the shapes a mechanical
// drawing draws an outline and its holes with (LINE, LWPOLYLINE, POLYLINE with its VERTEX list, CIRCLE, ARC). Every
// other entity is counted by type and left alone. Written from the format's public description: the file is a list of
// pairs of lines, a group code and its value; code 0 starts an entity or a section marker, 8 is the layer, 10/20 and
// 11/21 are points, 40 a radius, 42 a bulge, 50/51 angles in degrees, 70 flags.
import type { Point } from "../model.js"

/** The units a drawing's $INSUNITS names, among those a board is drawn in. */
export type DxfUnits = "inch" | "mm" | "cm" | "m"

export interface DxfVertex extends Point {
  /** tan(θ/4) of the arc from this vertex to the next, θ counter-clockwise; 0 for a straight edge. */
  bulge: number
}

interface Layered {
  layer: string
}

export type DxfEntity =
  | (Layered & { type: "LINE"; start: Point; end: Point })
  | (Layered & { type: "ARC"; centre: Point; radius: number; startAngle: number; endAngle: number })
  | (Layered & { type: "CIRCLE"; centre: Point; radius: number })
  | (Layered & { type: "LWPOLYLINE" | "POLYLINE"; vertices: DxfVertex[]; closed: boolean })

export interface DxfDrawing {
  /** The header's units; undefined when it names none (absent or 0, unitless). */
  units?: DxfUnits
  /** Units the header names that are not read (feet, mils, ...), as "$INSUNITS 2, feet". */
  otherUnits?: string
  entities: DxfEntity[]
  /** The entities not read, counted by type, e.g. { SPLINE: 2 }. */
  skipped: Record<string, number>
}

export class DxfError extends Error {}

const UNITS: Record<number, DxfUnits> = { 1: "inch", 4: "mm", 5: "cm", 6: "m" }
const OTHER_UNITS: Record<number, string> = { 2: "feet", 3: "miles", 7: "km", 8: "microinches", 9: "mils", 10: "yards" }

interface Pair {
  code: number
  value: string
}

function pairsOf(text: string): Pair[] {
  const lines = text.split(/\r?\n/)
  const pairs: Pair[] = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number((lines[i] as string).trim())
    if (!Number.isInteger(code)) throw new DxfError(`The file is not an ASCII DXF: line ${i + 1} is not a group code`)
    pairs.push({ code, value: (lines[i + 1] as string).trim() })
  }
  if (pairs.length === 0) throw new DxfError("The file is not an ASCII DXF: it has no group codes")
  return pairs
}

/** The pairs of each section by name, from SECTION to ENDSEC. */
function sections(pairs: readonly Pair[]): Map<string, Pair[]> {
  const found = new Map<string, Pair[]>()
  let current: Pair[] | undefined
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i] as Pair
    if (pair.code === 0 && pair.value === "SECTION") {
      const name = pairs[i + 1]
      current = []
      if (name?.code === 2) found.set(name.value, current)
      i++
    } else if (pair.code === 0 && pair.value === "ENDSEC") current = undefined
    else current?.push(pair)
  }
  return found
}

function unitsOf(header: readonly Pair[] | undefined): { units?: DxfUnits; otherUnits?: string } {
  if (!header) return {}
  const at = header.findIndex((pair) => pair.code === 9 && pair.value === "$INSUNITS")
  const value = at === -1 ? undefined : header.slice(at + 1).find((pair) => pair.code === 70)?.value
  const code = value === undefined ? 0 : Number(value)
  if (code === 0) return {}
  const units = UNITS[code]
  return units ? { units } : { otherUnits: `$INSUNITS ${code}${OTHER_UNITS[code] ? `, ${OTHER_UNITS[code]}` : ""}` }
}

/** The entities of the section: each a type and its own pairs, up to the next code 0. */
function groups(pairs: readonly Pair[]): { type: string; pairs: Pair[] }[] {
  const found: { type: string; pairs: Pair[] }[] = []
  for (const pair of pairs) {
    if (pair.code === 0) found.push({ type: pair.value, pairs: [] })
    else found.at(-1)?.pairs.push(pair)
  }
  return found
}

function numberAt(pairs: readonly Pair[], code: number, fallback?: number): number {
  const value = pairs.find((pair) => pair.code === code)?.value
  const number = value === undefined ? fallback : Number(value)
  if (number === undefined || !Number.isFinite(number)) throw new DxfError(`An entity is missing its group code ${code}, or it is not a number`)
  return number
}

const layerOf = (pairs: readonly Pair[]) => pairs.find((pair) => pair.code === 8)?.value ?? "0"
const pointAt = (pairs: readonly Pair[], code: number): Point => ({ x: numberAt(pairs, code), y: numberAt(pairs, code + 10) })
const closedFlag = (pairs: readonly Pair[]) => (numberAt(pairs, 70, 0) & 1) === 1

/** A LWPOLYLINE's vertices: each 10 starts one, its 20 and an optional 42 follow. */
function lwVertices(pairs: readonly Pair[]): DxfVertex[] {
  const vertices: DxfVertex[] = []
  for (const pair of pairs) {
    const last = vertices.at(-1)
    if (pair.code === 10) vertices.push({ x: Number(pair.value), y: Number.NaN, bulge: 0 })
    else if (pair.code === 20 && last) last.y = Number(pair.value)
    else if (pair.code === 42 && last) last.bulge = Number(pair.value)
  }
  if (vertices.some((v) => !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.bulge))) throw new DxfError("A LWPOLYLINE has a vertex that is not a number")
  return vertices
}

function simpleEntity(type: string, pairs: readonly Pair[]): DxfEntity | undefined {
  const layer = layerOf(pairs)
  switch (type) {
    case "LINE":
      return { type, layer, start: pointAt(pairs, 10), end: pointAt(pairs, 11) }
    case "ARC":
      return { type, layer, centre: pointAt(pairs, 10), radius: numberAt(pairs, 40), startAngle: numberAt(pairs, 50), endAngle: numberAt(pairs, 51) }
    case "CIRCLE":
      return { type, layer, centre: pointAt(pairs, 10), radius: numberAt(pairs, 40) }
    case "LWPOLYLINE":
      return { type, layer, vertices: lwVertices(pairs), closed: closedFlag(pairs) }
    default:
      return undefined
  }
}

/** VERTEX flag 16: a spline frame control point, not on the curve. */
const CONTROL_POINT = 16

function readEntities(section: readonly Pair[]): { entities: DxfEntity[]; skipped: Record<string, number> } {
  const entities: DxfEntity[] = []
  const skipped: Record<string, number> = {}
  let polyline: (Layered & { type: "POLYLINE"; vertices: DxfVertex[]; closed: boolean }) | undefined
  for (const { type, pairs } of groups(section)) {
    if (polyline && type === "VERTEX") {
      if ((numberAt(pairs, 70, 0) & CONTROL_POINT) === 0) polyline.vertices.push({ ...pointAt(pairs, 10), bulge: numberAt(pairs, 42, 0) })
      continue
    }
    if (polyline && type === "SEQEND") {
      polyline = undefined
      continue
    }
    polyline = undefined
    if (type === "POLYLINE") {
      const started = { type: "POLYLINE" as const, layer: layerOf(pairs), vertices: [] as DxfVertex[], closed: closedFlag(pairs) }
      polyline = started
      entities.push(started)
      continue
    }
    const entity = simpleEntity(type, pairs)
    if (entity) entities.push(entity)
    else skipped[type] = (skipped[type] ?? 0) + 1
  }
  return { entities, skipped }
}

/** Reads an ASCII DXF; refuses a binary one, text that is not a DXF and a file without an ENTITIES section. */
export function readDxf(text: string): DxfDrawing {
  if (text.startsWith("AutoCAD Binary DXF")) throw new DxfError("The file is a binary DXF; save the drawing as an ASCII DXF")
  const all = sections(pairsOf(text))
  const section = all.get("ENTITIES")
  if (!section) throw new DxfError("The DXF has no ENTITIES section, so nothing is drawn in it")
  return { ...unitsOf(all.get("HEADER")), ...readEntities(section) }
}
