// A DXF drawing as plain shapes. The board-outline reader (src/engine/dxf) reads the header's units and LINE, ARC,
// CIRCLE, LWPOLYLINE and POLYLINE; ELLIPSE, SPLINE, SOLID, HATCH and INSERT (of a block, one level) are read here
// from the file's pairs. Layers are not kept, only counted.
import type { Point } from "../model.js"
import { DxfError, readDxf, type DxfDrawing, type DxfUnits } from "../dxf/index.js"
import { drawnFromEntity, drawnFromGroup, type Drawn } from "./dxf-entities.js"
import { entitiesText, groups, numberAt, pairsOf, pointAt, sections, type Group, type Pair } from "./dxf-pairs.js"
import { fillsFromRings } from "./rings.js"
import { counted, CURVE_TOLERANCE_MM, finish, GraphicError, MAX_TOTAL_POINTS, type GraphicFill, type GraphicShapes, type GraphicStroke } from "./shapes.js"
import { apply, IDENTITY, maxScale, multiply, scaling, translation, type Matrix } from "./transform.js"

/** The largest DXF text read, in characters. */
export const MAX_DXF_TEXT = 2 * 1024 * 1024

const MM_PER: Record<DxfUnits, number> = { mm: 1, cm: 10, m: 1000, inch: 25.4 }
/** The entities read here rather than by the board-outline reader. */
const READ_HERE = new Set(["ELLIPSE", "SPLINE", "SOLID", "HATCH", "INSERT"])

interface Block {
  base: Point
  content: Group[]
}

interface Collected {
  fills: GraphicFill[]
  strokes: GraphicStroke[]
  notes: Map<string, number>
  layers: Set<string>
  points: number
}

const note = (out: Collected, what: string, count = 1): void => void out.notes.set(what, (out.notes.get(what) ?? 0) + count)

function readBoard(text: string): DxfDrawing {
  try {
    return readDxf(text)
  } catch (error) {
    if (error instanceof DxfError) throw new GraphicError(error.message)
    throw error
  }
}

function blocksOf(section: readonly Pair[] | undefined): Map<string, Block> {
  const blocks = new Map<string, Block>()
  let current: Block | undefined
  for (const g of groups(section ?? [])) {
    if (g.type === "BLOCK") {
      current = { base: pointAt(g.pairs, 10, 0), content: [] }
      blocks.set(g.pairs.find((p) => p.code === 2)?.value ?? "", current)
    } else if (g.type === "ENDBLK") current = undefined
    else current?.content.push(g)
  }
  return blocks
}

function add(drawn: Drawn, m: Matrix, out: Collected): void {
  const move = (points: readonly Point[]) => points.map((p) => apply(m, p))
  if (drawn.kind === "stroke") out.strokes.push({ points: move(drawn.points), width: 0, closed: drawn.closed })
  else out.fills.push(...fillsFromRings(drawn.rings.map(move), "evenodd"))
  out.points += drawn.kind === "stroke" ? drawn.points.length : drawn.rings.reduce((s, r) => s + r.length, 0)
  if (out.points > MAX_TOTAL_POINTS) throw new GraphicError(`The drawing comes to more than ${MAX_TOTAL_POINTS} points; simplify it first`)
}

function insertMatrix(pairs: readonly Pair[], base: Point): Matrix {
  const at = pointAt(pairs, 10, 0)
  const r = (numberAt(pairs, 50, 0) * Math.PI) / 180
  const turn: Matrix = { a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r), e: 0, f: 0 }
  const scale = scaling(numberAt(pairs, 41, 1), numberAt(pairs, 42, 1))
  return multiply(translation(at.x, at.y), multiply(turn, multiply(scale, translation(-base.x, -base.y))))
}

/** Draws a list of entity groups under `m`; `blocks` is undefined inside a block (INSERT is followed one level). */
function drawGroups(list: readonly Group[], basic: DxfDrawing, m: Matrix, blocks: Map<string, Block> | undefined, out: Collected): void {
  const scale = maxScale(m)
  if (!Number.isFinite(scale) || scale === 0) throw new GraphicError("An INSERT scales its block to nothing or to infinity")
  const tol = CURVE_TOLERANCE_MM / scale
  for (const e of basic.entities) add(drawnFromEntity(e, tol), m, out)
  for (const [type, count] of Object.entries(basic.skipped)) if (!READ_HERE.has(type)) note(out, type, count)
  for (const g of list) if (g.type !== "VERTEX" && g.type !== "SEQEND") out.layers.add(g.pairs.find((p) => p.code === 8)?.value ?? "0")
  for (const g of list.filter((item) => READ_HERE.has(item.type))) {
    if (g.type === "INSERT") drawInsert(g, m, blocks, out)
    else {
      const { drawn, leftOut } = drawnFromGroup(g, tol)
      if (drawn) add(drawn, m, out)
      if (leftOut) note(out, leftOut)
    }
  }
}

function drawInsert(g: Group, m: Matrix, blocks: Map<string, Block> | undefined, out: Collected): void {
  if (!blocks) return note(out, "INSERT inside a block, left out (blocks are followed one level)")
  const name = g.pairs.find((p) => p.code === 2)?.value ?? ""
  const block = blocks.get(name)
  if (!block) return note(out, "INSERT of a block the file does not have")
  if (numberAt(g.pairs, 70, 1) > 1 || numberAt(g.pairs, 71, 1) > 1) note(out, "INSERT array drawn once")
  drawGroups(block.content, readBoard(entitiesText(block.content)), multiply(m, insertMatrix(g.pairs, block.base)), undefined, out)
}

function notesOf(out: Collected, unitless: boolean): string[] {
  const left = [...out.notes].map(([what, count]) => (/^[A-Z]+$/.test(what) ? counted(count, `${what} entity`, `${what} entities`) : `${count} ${what}`))
  const layers = out.layers.size > 1 ? [`${out.layers.size} layers, not kept: all are drawn alike`] : []
  return [...(unitless ? ["The file names no units: read as mm"] : []), ...left, ...layers]
}

/** Reads a DXF file's text; throws a GraphicError saying what is wrong with it. */
export function readDxfGraphic(text: string): GraphicShapes {
  if (text.length > MAX_DXF_TEXT) throw new GraphicError("The DXF file is larger than 2 MB; simplify it first")
  const basic = readBoard(text)
  if (basic.otherUnits) throw new GraphicError(`The drawing's units are ${basic.otherUnits}; save it in mm or inches`)
  const all = sections(pairsOf(text))
  const out: Collected = { fills: [], strokes: [], notes: new Map(), layers: new Set(), points: 0 }
  const mm = basic.units ? MM_PER[basic.units] : 1
  drawGroups(groups(all.get("ENTITIES") ?? []), basic, multiply(scaling(mm, mm), IDENTITY), blocksOf(all.get("BLOCKS")), out)
  return finish(out.fills, out.strokes, notesOf(out, basic.units === undefined))
}
