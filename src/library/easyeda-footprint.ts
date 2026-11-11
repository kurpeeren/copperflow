// An EasyEDA footprint document (the `packageDetail.dataStr` of a part) as copperflow's footprint.yaml content.
// EasyEDA draws in units of 10 mil with y growing downwards around the document's origin (head.x, head.y);
// footprint.yaml is in mm with y up around the part centre. Pad numbers are kept as EasyEDA writes them; the importer
// maps the ones that are not pin numbers.
import { DEFAULT_COURTYARD_EXCESS, paddedBounds } from "../engine/footprints/file.js"
import { circlePoints, pathPolylines, type RawPoint } from "./easyeda-path.js"

/** One EasyEDA unit in mm: the format's unit is 10 mil. */
export const EASYEDA_UNIT_MM = 0.254

/** How near two ends of body segments must be to join, in mm. */
const JOIN_TOLERANCE = 0.001

const LAYER = { top: "1", bottom: "2", topSilk: "3", multi: "11", body: "99" } as const

export interface EasyedaDocument {
  head: { x?: number | string; y?: number | string; c_para?: Record<string, string>; license?: string }
  shape: string[]
}

/** A pad as footprint.yaml writes it, with the number EasyEDA gave it, which may not be a pin number yet. */
export interface ConvertedPad {
  number: string
  shape: "rect" | "circle" | "oval"
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  layers?: "through"
  drill?: number | { width: number; height: number }
}

export interface ConvertedFootprint {
  pads: ConvertedPad[]
  courtyard: [number, number][]
  silkscreen: [number, number][][]
  body?: [number, number][]
  /** What the conversion approximated or left out, for verification.md. */
  notes: string[]
}

type Place = (point: RawPoint) => [number, number]

/** Converts the footprint; throws when it holds something footprint.yaml cannot, such as a pad on the bottom side. */
export function convertFootprint(doc: EasyedaDocument): ConvertedFootprint {
  const ox = Number(doc.head.x ?? 0)
  const oy = Number(doc.head.y ?? 0)
  const place: Place = (p) => [mm(p.x - ox), mm(oy - p.y)]
  const notes: string[] = []
  const pads: ConvertedPad[] = []
  const silkscreen: [number, number][][] = []
  const bodies: [number, number][][] = []
  for (const record of doc.shape) {
    const fields = record.split("~")
    switch (fields[0]) {
      case "PAD": {
        const pad = convertPad(fields, place, notes)
        if (pad) pads.push(pad)
        break
      }
      case "HOLE":
        notes.push(`An unplated hole of ${fmt(mm(2 * num(fields[3])))} mm at (${place(point(fields[1], fields[2])).map(fmt).join(", ")}) is not in footprint.yaml; add it to the board as a hole.`)
        break
      default: {
        const lines = outline(fields, place)
        if (!lines) break
        if (lines.layer === LAYER.topSilk) silkscreen.push(...lines.polylines)
        else if (lines.layer === LAYER.body) bodies.push(...lines.polylines)
      }
    }
  }
  if (pads.length === 0) throw new Error("the footprint has no pads")
  const body = largest(closedRings(bodies))
  if (!body) notes.push(bodies.length === 0 ? "The footprint draws no body outline, so footprint.yaml has none." : "The body outline (EasyEDA layer 99) is not closed, so footprint.yaml has no body.")
  return { pads, courtyard: courtyardAround(pads, body), silkscreen, ...(body ? { body: openRing(body) } : {}), notes }
}

/** PAD~shape~x~y~width~height~layer~net~number~holeRadius~points~rotation~id~holeLength~holePoints~plated~… */
function convertPad(fields: string[], place: Place, notes: string[]): ConvertedPad | undefined {
  const [, kind = "", x = "", y = "", width = "", height = "", layer = "", , numberText = "", holeRadius = "0", points = "", rotationText = "0", , holeLength = "0", holePoints = "", plated = "Y"] = fields
  const label = numberText.trim()
  const centre = place(point(x, y))
  const drillDiameter = mm(2 * num(holeRadius))
  if (layer === LAYER.bottom) throw new Error(`pad ${label || "(no number)"} is on the bottom side, which footprint.yaml cannot hold`)
  if (drillDiameter > 0 && plated.trim().toUpperCase() === "N") {
    notes.push(`An unplated pad hole of ${fmt(drillDiameter)} mm at (${centre.map(fmt).join(", ")}) is not in footprint.yaml; add it to the board as a hole.`)
    return undefined
  }
  if (layer !== LAYER.top && layer !== LAYER.multi) throw new Error(`pad ${label || "(no number)"} is on EasyEDA layer ${layer}, not the top or all copper layers`)
  // EasyEDA turns clockwise on its y-down page, which is counter-clockwise seen with y up.
  const rotation = normaliseRotation(-num(rotationText))
  const size = padShape(kind, { w: num(width), h: num(height), points, rotation, centre }, place, label, notes)
  const through = layer === LAYER.multi && drillDiameter > 0
  const quarter = size.rotation === 90
  const pad: ConvertedPad = {
    number: label,
    shape: size.shape,
    x: round(centre[0] + size.offset[0]),
    y: round(centre[1] + size.offset[1]),
    // A quarter turn is written as swapped sides, which reads more plainly.
    width: quarter ? size.height : size.width,
    height: quarter ? size.width : size.height,
    ...(size.rotation !== 0 && !quarter ? { rotation: size.rotation } : {}),
  }
  if (!through) return pad
  return { ...pad, layers: "through", drill: drill(drillDiameter, mm(num(holeLength)), holePoints, pad, quarter ? 0 : size.rotation, place) }
}

interface PadSize {
  shape: ConvertedPad["shape"]
  width: number
  height: number
  rotation: number
  /** From the EasyEDA pad position to the centre of the shape written, in mm (non-zero only for polygons). */
  offset: [number, number]
}

interface PadInput {
  w: number
  h: number
  points: string
  rotation: number
  /** The EasyEDA pad position in mm. */
  centre: [number, number]
}

function padShape(kind: string, input: PadInput, place: Place, label: string, notes: string[]): PadSize {
  const { w, h, rotation } = input
  const width = mm(w)
  const height = mm(h)
  // Pads are symmetric under a half turn, so only the rotation modulo 180 matters.
  const halfTurn = rotation % 180
  switch (kind.toUpperCase()) {
    case "RECT":
      return { shape: "rect", width, height, rotation: halfTurn, offset: [0, 0] }
    case "OVAL":
      return width === height ? { shape: "circle", width, height, rotation: 0, offset: [0, 0] } : { shape: "oval", width, height, rotation: halfTurn, offset: [0, 0] }
    case "ELLIPSE":
      if (width === height) return { shape: "circle", width, height, rotation: 0, offset: [0, 0] }
      notes.push(`Pad ${label}: an elliptical pad (${fmt(width)} x ${fmt(height)} mm) is drawn as an oval of the same size.`)
      return { shape: "oval", width, height, rotation: halfTurn, offset: [0, 0] }
    case "POLYGON":
      return polygonPad(input, place, label, notes)
    default:
      throw new Error(`pad ${label} has the shape "${kind}", which copperflow does not know`)
  }
}

/** A polygon pad as the rectangle that bounds it in the pad's own frame. */
function polygonPad({ points, rotation, centre: at }: PadInput, place: Place, label: string, notes: string[]): PadSize {
  const values = points.trim().split(/[\s,]+/).map(Number)
  const corners: [number, number][] = []
  for (let i = 0; i + 1 < values.length; i += 2) corners.push(place({ x: values[i] as number, y: values[i + 1] as number }))
  if (corners.length < 3 || corners.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) throw new Error(`polygon pad ${label} has no outline`)
  const angle = (rotation * Math.PI) / 180
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
  // Corners in the pad's frame: turned back by the pad's rotation.
  const local = corners.map(([x, y]) => [x * cos + y * sin, -x * sin + y * cos] as const)
  const xs = local.map(([x]) => x)
  const ys = local.map(([, y]) => y)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const [lx, ly] = [(minX + maxX) / 2, (minY + maxY) / 2]
  const centre: [number, number] = [lx * cos - ly * sin, lx * sin + ly * cos]
  const width = round(maxX - minX)
  const height = round(maxY - minY)
  notes.push(`Pad ${label}: a polygon pad is drawn as the rectangle around it (${fmt(width)} x ${fmt(height)} mm); check its shape against the land pattern.`)
  // The offset is measured from the EasyEDA pad position, which convertPad adds back.
  return { shape: "rect", width, height, rotation: rotation % 180, offset: [centre[0] - at[0], centre[1] - at[1]] }
}

/** A round hole, or a slot `length` long (its full length) along the pad's longer side or the slot's own line. */
function drill(diameter: number, length: number, holePoints: string, pad: ConvertedPad, rotation: number, place: Place): ConvertedPad["drill"] {
  if (!(length > diameter)) return diameter
  const values = holePoints.trim().split(/[\s,]+/).map(Number)
  let alongWidth = pad.width >= pad.height
  if (values.length >= 4 && values.slice(0, 4).every(Number.isFinite)) {
    const [ax, ay] = place({ x: values[0] as number, y: values[1] as number })
    const [bx, by] = place({ x: values[2] as number, y: values[3] as number })
    const angle = Math.atan2(by - ay, bx - ax) - (rotation * Math.PI) / 180
    if (bx !== ax || by !== ay) alongWidth = Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle))
  }
  return alongWidth ? { width: length, height: diameter } : { width: diameter, height: length }
}

/** The polylines a drawing record makes, and its layer; undefined for records that draw nothing copperflow keeps. */
function outline(fields: string[], place: Place): { layer: string; polylines: [number, number][][] } | undefined {
  const toMm = (line: RawPoint[]) => line.map(place)
  switch (fields[0]) {
    // TRACK~width~layer~net~x y x y …~id
    case "TRACK": {
      const values = (fields[4] ?? "").trim().split(/[\s,]+/).map(Number)
      const line: RawPoint[] = []
      for (let i = 0; i + 1 < values.length; i += 2) line.push({ x: values[i] as number, y: values[i + 1] as number })
      return line.length >= 2 ? { layer: fields[2] ?? "", polylines: [toMm(line)] } : undefined
    }
    // ARC~width~layer~net~path~…
    case "ARC":
      return { layer: fields[2] ?? "", polylines: pathPolylines(fields[4] ?? "").map(toMm) }
    // CIRCLE~cx~cy~r~width~layer~id
    case "CIRCLE":
      return { layer: fields[5] ?? "", polylines: [toMm(circlePoints(point(fields[1], fields[2]), num(fields[3])))] }
    // SOLIDREGION~layer~net~path~fill~id
    case "SOLIDREGION":
      return { layer: fields[1] ?? "", polylines: pathPolylines(fields[3] ?? "").map(toMm) }
    // RECT~x~y~width~height~layer~id (x, y the top left corner)
    case "RECT": {
      const [x, y, w, h] = [num(fields[1]), num(fields[2]), num(fields[3]), num(fields[4])]
      const ring = [point(x, y), point(x + w, y), point(x + w, y + h), point(x, y + h), point(x, y)]
      return { layer: fields[5] ?? "", polylines: [toMm(ring)] }
    }
    default:
      return undefined
  }
}

/** footprint.yaml's default courtyard around the pads, enlarged to take in the body. */
function courtyardAround(pads: readonly ConvertedPad[], body: [number, number][] | undefined): [number, number][] {
  const points = (body ?? []).map(([x, y]) => ({ x, y }))
  return paddedBounds(pads.map((pad) => ({ ...pad, rotation: pad.rotation ?? 0 })), DEFAULT_COURTYARD_EXCESS, points).map(({ x, y }) => [round(x), round(y)] as [number, number])
}

/**
 * The closed rings among the outlines: those that end where they start, and open segments joined end to end
 * (in either direction) until they close. Chains that never close are left out.
 */
export function closedRings(lines: readonly [number, number][][]): [number, number][][] {
  const near = (a: [number, number] | undefined, b: [number, number] | undefined) => !!a && !!b && Math.hypot(a[0] - b[0], a[1] - b[1]) <= JOIN_TOLERANCE
  const isClosed = (line: [number, number][]) => line.length >= 4 && near(line[0], line[line.length - 1])
  const rings = lines.filter(isClosed)
  const open = lines.filter((line) => !isClosed(line) && line.length >= 2).map((line) => [...line])
  while (open.length > 0) {
    let chain = open.shift() as [number, number][]
    for (let grown = true; grown && !isClosed(chain); ) {
      grown = false
      const end = chain[chain.length - 1]
      const index = open.findIndex((line) => near(line[0], end) || near(line[line.length - 1], end))
      if (index === -1) break
      const next = open.splice(index, 1)[0] as [number, number][]
      chain = [...chain, ...(near(next[0], end) ? next : [...next].reverse()).slice(1)]
      grown = true
    }
    if (isClosed(chain)) rings.push(chain)
  }
  return rings
}

/** The outline enclosing the most area, as the body. */
function largest(rings: [number, number][][]): [number, number][] | undefined {
  let best: [number, number][] | undefined
  let bestArea = 0
  for (const ring of rings) {
    const area = Math.abs(ring.reduce((sum, [x, y], i) => {
      const [nx, ny] = ring[(i + 1) % ring.length] as [number, number]
      return sum + x * ny - nx * y
    }, 0)) / 2
    if (ring.length >= 3 && area > bestArea) {
      best = ring
      bestArea = area
    }
  }
  return best
}

/** A closed ring without its repeated last point: footprint.yaml closes the body itself. */
function openRing(ring: [number, number][]): [number, number][] {
  const first = ring[0]
  const last = ring[ring.length - 1]
  return first && last && ring.length > 3 && first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring
}

function point(x: string | number | undefined, y: string | number | undefined): RawPoint {
  return { x: num(x), y: num(y) }
}

function num(text: string | number | undefined): number {
  const value = Number(text)
  if (text === undefined || text === "" || !Number.isFinite(value)) throw new Error(`"${String(text)}" is not a number`)
  return value
}

/** Units to mm, rounded to 0.1 µm so the yaml stays readable and the same input always writes the same file. */
function mm(units: number): number {
  return round(units * EASYEDA_UNIT_MM)
}

function round(value: number): number {
  const rounded = Math.round(value * 10000) / 10000
  return Object.is(rounded, -0) ? 0 : rounded
}

function normaliseRotation(degrees: number): number {
  return round(((degrees % 360) + 360) % 360)
}

function fmt(value: number): string {
  return String(round(value))
}
