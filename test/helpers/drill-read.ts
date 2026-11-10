// Reads a written Excellon drill file back with the independent parser (@tracespace/parser) into what the tests compare
// against the model: the comments (X2 attributes are written as comments), the units, each tool's diameter, the drilled
// holes and the routed slots (G85), each with its tool. Coordinates in mm.
import { parse } from "@tracespace/parser"

export interface Point {
  x: number
  y: number
}

export interface ReadDrill {
  filetype: string
  comments: string[]
  units?: string
  /** Tool code to diameter in mm, in the order defined. */
  tools: Map<string, number>
  holes: { tool: string; at: Point }[]
  slots: { tool: string; from: Point; to: Point }[]
  done: boolean
}

interface Node {
  type: string
  comment?: string
  units?: string
  code?: string
  shape?: { type: string; diameter?: number }
  graphic?: string | null
  coordinates?: Record<string, string>
  position?: { start: { offset?: number }; end: { offset?: number } }
}

const number = (value: string | undefined) => Number(value ?? "0")

/** Parses the file; throws when it is not a drill file or a hole uses an undefined tool. */
export function readDrill(text: string): ReadDrill {
  const tree = parse(text)
  const read: ReadDrill = { filetype: String(tree.filetype), comments: [], tools: new Map(), holes: [], slots: [], done: false }
  let tool: string | undefined
  for (const node of tree.children as unknown as Node[]) {
    switch (node.type) {
      case "comment":
        // The comment as written: the parser's own value drops a "T0" inside a date, so the source text is read.
        read.comments.push(text.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0).replace(/^;\s*/, "").trim())
        break
      case "units":
        if (node.units) read.units = node.units
        break
      case "toolDefinition":
        read.tools.set(node.code ?? "", node.shape?.diameter ?? Number.NaN)
        break
      case "toolChange":
        tool = node.code
        break
      case "graphic": {
        if (tool === undefined || !read.tools.has(tool)) throw new Error(`hole with tool T${tool} that is not defined`)
        const c = node.coordinates ?? {}
        if (node.graphic === "slot") read.slots.push({ tool, from: { x: number(c["x0"]), y: number(c["y0"]) }, to: { x: number(c["x"]), y: number(c["y"]) } })
        else read.holes.push({ tool, at: { x: number(c["x"]), y: number(c["y"]) } })
        break
      }
      case "done":
        read.done = true
        break
      default:
        break
    }
  }
  if (read.filetype !== "drill") throw new Error(`not a drill file: ${read.filetype}`)
  if (!read.done) throw new Error("the drill file has no M30 end")
  return read
}
