// SVG path data ("M0 0 L10 0 ...") as subpaths of points, curves flattened. Every command, both cases, implicit
// repeats (extra pairs after M are lines), and the number grammar where separators may be left out ("1.5.5" is 1.5
// and .5, "-.5", "1e-3"; arc flags are one digit each, so "a5 5 0 1010 0" reads). As the format asks, a path with an
// error is drawn up to the error; the caller is told.
import type { Point } from "../model.js"
import { cubic, quadratic, svgArc } from "./curves.js"
import { GraphicError, MAX_TOTAL_POINTS } from "./shapes.js"

export interface Subpath {
  points: Point[]
  closed: boolean
}

export interface PathData {
  subpaths: Subpath[]
  /** True when the data had an error and was read only up to it. */
  broken: boolean
}

const NUMBER = /[\s,]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/y
const FLAG = /[\s,]*([01])/y
const COMMAND = /[\s,]*([MmLlHhVvCcSsQqTtAaZz])/y
const END = /[\s,]*$/y

class Cursor {
  at = 0
  constructor(readonly text: string) {}
  private take(pattern: RegExp): string | undefined {
    pattern.lastIndex = this.at
    const found = pattern.exec(this.text)
    if (!found) return undefined
    this.at = pattern.lastIndex
    return found[1]
  }
  command = () => this.take(COMMAND)
  number(): number {
    const text = this.take(NUMBER)
    const value = text === undefined ? Number.NaN : Number(text)
    if (!Number.isFinite(value)) throw new GraphicError("bad number")
    return value
  }
  flag = (): boolean => {
    const text = this.take(FLAG)
    if (text === undefined) throw new GraphicError("bad flag")
    return text === "1"
  }
  hasNumber(): boolean {
    NUMBER.lastIndex = this.at
    return NUMBER.test(this.text)
  }
  atEnd(): boolean {
    END.lastIndex = this.at
    return END.test(this.text)
  }
}

interface State {
  subpaths: Subpath[]
  current: Point[]
  start: Point
  pen: Point
  /** The last control point of a C/S or Q/T, for the reflections of S and T. */
  lastCubic?: Point
  lastQuad?: Point
  count: number
}

function push(state: State, points: readonly Point[]): void {
  state.count += points.length
  if (state.count > MAX_TOTAL_POINTS) throw new GraphicError(`The drawing comes to more than ${MAX_TOTAL_POINTS} points; simplify it first`)
  state.current.push(...points)
  const last = points.at(-1)
  if (last) state.pen = last
}

function endSubpath(state: State, closed: boolean): void {
  if (state.current.length > 1) state.subpaths.push({ points: state.current, closed })
  state.current = closed ? [state.start] : []
  if (closed) state.pen = state.start
}

const reflect = (about: Point, p: Point | undefined): Point => (p ? { x: 2 * about.x - p.x, y: 2 * about.y - p.y } : about)

function readPoint(c: Cursor, relative: boolean, pen: Point): Point {
  const x = c.number()
  const y = c.number()
  return relative ? { x: pen.x + x, y: pen.y + y } : { x, y }
}

/** One command's arguments, once; returns the points it draws. */
function step(c: Cursor, cmd: string, s: State, tolerance: number): Point[] {
  const rel = cmd === cmd.toLowerCase()
  const pen = s.pen
  switch (cmd.toUpperCase()) {
    case "L":
      return [readPoint(c, rel, pen)]
    case "H": {
      const x = c.number()
      return [{ x: rel ? pen.x + x : x, y: pen.y }]
    }
    case "V": {
      const y = c.number()
      return [{ x: pen.x, y: rel ? pen.y + y : y }]
    }
    case "C":
    case "S": {
      const p1 = cmd.toUpperCase() === "C" ? readPoint(c, rel, pen) : reflect(pen, s.lastCubic)
      const p2 = readPoint(c, rel, pen)
      const p3 = readPoint(c, rel, pen)
      s.lastCubic = p2
      return cubic(pen, p1, p2, p3, tolerance)
    }
    case "Q":
    case "T": {
      const p1 = cmd.toUpperCase() === "Q" ? readPoint(c, rel, pen) : reflect(pen, s.lastQuad)
      const p2 = readPoint(c, rel, pen)
      s.lastQuad = p1
      return quadratic(pen, p1, p2, tolerance)
    }
    case "A": {
      const [rx, ry, angle] = [c.number(), c.number(), c.number()]
      const [large, sweep] = [c.flag(), c.flag()]
      return svgArc(pen, rx, ry, angle, large, sweep, readPoint(c, rel, pen), tolerance)
    }
    default:
      throw new GraphicError("bad command")
  }
}

function moveTo(c: Cursor, rel: boolean, s: State): void {
  if (s.current.length > 0) endSubpath(s, false)
  const p = readPoint(c, rel, s.pen)
  s.current = []
  s.start = p
  s.pen = p
  push(s, [p])
}

function runCommand(c: Cursor, cmd: string, s: State, tolerance: number): void {
  const upper = cmd.toUpperCase()
  if (upper === "Z") {
    endSubpath(s, true)
    return
  }
  if (upper === "M") moveTo(c, cmd === "m", s)
  const repeat = upper === "M" ? (cmd === "m" ? "l" : "L") : cmd
  if (upper !== "M") runOnce(c, repeat, s, tolerance)
  while (c.hasNumber()) runOnce(c, repeat, s, tolerance)
}

function runOnce(c: Cursor, cmd: string, s: State, tolerance: number): void {
  if (s.current.length === 0) push(s, [s.pen])
  const points = step(c, cmd, s, tolerance)
  const upper = cmd.toUpperCase()
  if (upper !== "C" && upper !== "S") s.lastCubic = undefined
  if (upper !== "Q" && upper !== "T") s.lastQuad = undefined
  push(s, points)
}

/** The subpaths of path data, curves flattened to `tolerance` (in the path's own units); `pointsBefore` counts against the drawing's limit. */
export function parsePathData(text: string, tolerance: number, pointsBefore = 0): PathData {
  const c = new Cursor(text)
  const origin = { x: 0, y: 0 }
  const s: State = { subpaths: [], current: [], start: origin, pen: origin, count: pointsBefore }
  let broken = false
  try {
    const first = c.command()
    if (first !== undefined && first.toUpperCase() !== "M") throw new GraphicError("bad start")
    for (let cmd = first; cmd !== undefined; cmd = c.command()) runCommand(c, cmd, s, tolerance)
    broken = !c.atEnd()
  } catch (error) {
    if (!(error instanceof GraphicError) || error.message.includes("points")) throw error
    broken = true
  }
  if (s.current.length > 1) s.subpaths.push({ points: s.current, closed: false })
  return { subpaths: s.subpaths, broken }
}
