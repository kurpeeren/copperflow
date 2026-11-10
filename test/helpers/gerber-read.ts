// Reads a written Gerber file back with the independent parser (@tracespace/parser) into what the tests compare against
// the model: the X2 file attributes, the apertures with their aperture function, the flashes, the drawn segments
// (grouped into strokes, one per D02 move followed by draws) and the regions. Coordinates in mm.
import { parse } from "@tracespace/parser"

export interface Point {
  x: number
  y: number
}

export interface ReadAperture {
  code: string
  shape: Record<string, unknown> & { type: string }
  /** The `.AperFunction` attribute set when the aperture was defined, e.g. "SMDPad,CuDef"; undefined without one. */
  fn?: string
}

export interface ReadGerber {
  /** The `%TF...*%` lines, e.g. ".FileFunction,Copper,L1,Top". */
  fileAttributes: string[]
  macros: string[]
  format?: [number, number]
  units?: string
  apertures: Map<string, ReadAperture>
  flashes: { at: Point; aperture: ReadAperture }[]
  /** Each stroke: the point a move left it at and the points of the draws that follow, with the aperture drawn with. */
  strokes: { points: Point[]; aperture: ReadAperture }[]
  /** Each region's corners as written, the closing corner included; `fn` is the aperture function set when it began. */
  regions: { points: Point[]; fn?: string }[]
  done: boolean
}

interface Node {
  type: string
  value?: string
  name?: string
  code?: string
  shape?: ReadAperture["shape"]
  format?: [number, number]
  units?: string
  graphic?: string
  region?: boolean
  coordinates?: Record<string, string>
  position?: { start: { offset?: number }; end: { offset?: number } }
}

const ATTRIBUTE = /^%?(T[FAOD])(.*?)\*?%?$/

function coordinate(value: string | undefined, decimals: number, last: number): number {
  return value === undefined ? last : Number(value) / 10 ** decimals
}

/** Parses the file; throws when the parser cannot read it to its end. */
export function readGerber(text: string): ReadGerber {
  const tree = parse(text)
  const read: ReadGerber = { fileAttributes: [], macros: [], apertures: new Map(), flashes: [], strokes: [], regions: [], done: false }
  let fn: string | undefined
  let tool: ReadAperture | undefined
  let inRegion = false
  let at: Point = { x: 0, y: 0 }
  let stroke: { points: Point[]; aperture: ReadAperture } | undefined
  let region: { points: Point[]; fn?: string } | undefined
  for (const node of tree.children as unknown as Node[]) {
    if (node.type === "unimplemented") {
      // The statement as written: the parser's own value drops a "T0" inside a date, so the source text is read.
      const written = text.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0).trim()
      const match = ATTRIBUTE.exec(written)
      if (!match) throw new Error(`unread Gerber statement: ${written}`)
      const [, kind, body] = match as unknown as [string, string, string]
      if (kind === "TF") read.fileAttributes.push(body)
      else if (kind === "TA" && body.startsWith(".AperFunction,")) fn = body.slice(".AperFunction,".length)
      else if (kind === "TD") fn = undefined
      continue
    }
    switch (node.type) {
      case "coordinateFormat":
        if (node.format) read.format = node.format
        break
      case "units":
        if (node.units) read.units = node.units
        break
      case "toolMacro":
        read.macros.push(node.name ?? "")
        break
      case "toolDefinition":
        read.apertures.set(node.code ?? "", { code: node.code ?? "", shape: node.shape ?? { type: "unknown" }, ...(fn === undefined ? {} : { fn }) })
        break
      case "toolChange":
        tool = read.apertures.get(node.code ?? "")
        if (!tool) throw new Error(`aperture D${node.code} used before it is defined`)
        break
      case "regionMode":
        inRegion = node.region === true
        if (inRegion) region = { points: [], ...(fn === undefined ? {} : { fn }) }
        else if (region) {
          read.regions.push(region)
          region = undefined
        }
        stroke = undefined
        break
      case "graphic": {
        const decimals = read.format?.[1] ?? 6
        const from = at
        at = { x: coordinate(node.coordinates?.["x"], decimals, at.x), y: coordinate(node.coordinates?.["y"], decimals, at.y) }
        if (inRegion && region) {
          region.points.push(at)
          break
        }
        if (node.graphic === "shape") {
          if (!tool) throw new Error("flash without an aperture")
          read.flashes.push({ at, aperture: tool })
        } else if (node.graphic === "move") {
          stroke = undefined
        } else if (node.graphic === "segment") {
          if (!tool) throw new Error("draw without an aperture")
          if (!stroke) {
            stroke = { points: [from], aperture: tool }
            read.strokes.push(stroke)
          }
          stroke.points.push(at)
        }
        break
      }
      case "done":
        read.done = true
        break
      default:
        break
    }
  }
  if (!read.done) throw new Error("the Gerber file has no M02 end")
  return read
}
