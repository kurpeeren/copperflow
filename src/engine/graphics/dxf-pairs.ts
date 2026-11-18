// The group-code pairs of an ASCII DXF, for the entities the board-outline reader (src/engine/dxf/reader.ts) does not
// read: ELLIPSE, SPLINE, SOLID, HATCH, INSERT and the BLOCKS section. pairsOf, sections and groups are copied from
// that file's private functions of the same names (it does not export them), with its errors turned into
// GraphicError; the reader itself is imported for everything it does read.
import type { Point } from "../model.js"
import { GraphicError } from "./shapes.js"

export interface Pair {
  code: number
  value: string
}

export interface Group {
  type: string
  pairs: Pair[]
}

export function pairsOf(text: string): Pair[] {
  const lines = text.split(/\r?\n/)
  const pairs: Pair[] = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number((lines[i] as string).trim())
    if (!Number.isInteger(code)) throw new GraphicError(`The file is not an ASCII DXF: line ${i + 1} is not a group code`)
    pairs.push({ code, value: (lines[i + 1] as string).trim() })
  }
  if (pairs.length === 0) throw new GraphicError("The file is not an ASCII DXF: it has no group codes")
  return pairs
}

/** The pairs of each section by name, from SECTION to ENDSEC. */
export function sections(pairs: readonly Pair[]): Map<string, Pair[]> {
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

/** The entities of a section: each a type and its own pairs, up to the next code 0. */
export function groups(pairs: readonly Pair[]): Group[] {
  const found: Group[] = []
  for (const pair of pairs) {
    if (pair.code === 0) found.push({ type: pair.value, pairs: [] })
    else found.at(-1)?.pairs.push(pair)
  }
  return found
}

/** The groups back as DXF text, inside an ENTITIES section, for the board-outline reader. */
export function entitiesText(list: readonly Group[]): string {
  const body = list.flatMap((g) => ["0", g.type, ...g.pairs.flatMap((p) => [String(p.code), p.value])])
  return ["0", "SECTION", "2", "ENTITIES", ...body, "0", "ENDSEC", "0", "EOF", ""].join("\n")
}

function finite(value: string, code: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new GraphicError(`An entity's group code ${code} is not a finite number`)
  return number
}

export function numberAt(pairs: readonly Pair[], code: number, fallback?: number): number {
  const value = pairs.find((pair) => pair.code === code)?.value
  if (value === undefined) {
    if (fallback === undefined) throw new GraphicError(`An entity is missing its group code ${code}`)
    return fallback
  }
  return finite(value, code)
}

export const pointAt = (pairs: readonly Pair[], code: number, fallback?: number): Point => ({ x: numberAt(pairs, code, fallback), y: numberAt(pairs, code + 10, fallback) })

/** Every value of a code, in order, as numbers. */
export const numbersOf = (pairs: readonly Pair[], code: number): number[] => pairs.filter((p) => p.code === code).map((p) => finite(p.value, code))

/** Every point a pair of codes lists, in order (each x code starts one). */
export function pointsOf(pairs: readonly Pair[], code: number): Point[] {
  const xs = numbersOf(pairs, code)
  const ys = numbersOf(pairs, code + 10)
  if (xs.length !== ys.length) throw new GraphicError(`An entity lists ${xs.length} x values and ${ys.length} y values`)
  return xs.map((x, i) => ({ x, y: ys[i] as number }))
}
