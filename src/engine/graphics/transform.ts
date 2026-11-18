// 2D affine transforms as SVG writes them: [a c e; b d f; 0 0 1], and the transform attribute's list.
import type { Point } from "../model.js"
import { GraphicError } from "./shapes.js"

export interface Matrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** m · n: n applied first, then m. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  }
}

export function apply(m: Matrix, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }
}

export const translation = (x: number, y: number): Matrix => ({ ...IDENTITY, e: x, f: y })
export const scaling = (x: number, y: number): Matrix => ({ ...IDENTITY, a: x, d: y })

/** The geometric mean of the two axis scales: what a stroke width is multiplied by. */
export function meanScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c))
}

/** The largest stretch the transform gives any direction (an upper bound): what a tolerance is divided by. */
export function maxScale(m: Matrix): number {
  return Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d))
}

function rotation(degrees: number, cx = 0, cy = 0): Matrix {
  const r = (degrees * Math.PI) / 180
  const turn = { a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r), e: 0, f: 0 }
  return multiply(translation(cx, cy), multiply(turn, translation(-cx, -cy)))
}

const skew = (axis: "x" | "y", degrees: number): Matrix => {
  const t = Math.tan((degrees * Math.PI) / 180)
  return axis === "x" ? { ...IDENTITY, c: t } : { ...IDENTITY, b: t }
}

function one(name: string, args: readonly number[]): Matrix {
  const [p, q, r] = args
  const n = args.length
  const wrong = () => new GraphicError(`A transform "${name}" has ${n} numbers, which it does not take`)
  switch (name) {
    case "matrix":
      if (n !== 6) throw wrong()
      return { a: args[0] as number, b: args[1] as number, c: args[2] as number, d: args[3] as number, e: args[4] as number, f: args[5] as number }
    case "translate":
      if (n < 1 || n > 2) throw wrong()
      return translation(p as number, q ?? 0)
    case "scale":
      if (n < 1 || n > 2) throw wrong()
      return scaling(p as number, q ?? (p as number))
    case "rotate":
      if (n !== 1 && n !== 3) throw wrong()
      return rotation(p as number, q ?? 0, r ?? 0)
    case "skewX":
    case "skewY":
      if (n !== 1) throw wrong()
      return skew(name === "skewX" ? "x" : "y", p as number)
    default:
      throw new GraphicError(`A transform names "${name}", which is not an SVG transform`)
  }
}

const ITEM = /\s*,?\s*([A-Za-z]+)\s*\(([^)]*)\)/y
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g

/** The transform attribute's list as one matrix; the first item is the outermost. */
export function parseTransform(text: string): Matrix {
  let m = IDENTITY
  ITEM.lastIndex = 0
  let at = 0
  for (;;) {
    ITEM.lastIndex = at
    const found = ITEM.exec(text)
    if (!found) break
    const args = (found[2] as string).match(NUMBER)?.map(Number) ?? []
    if (args.some((v) => !Number.isFinite(v))) throw new GraphicError("A transform has a number that is not finite")
    m = multiply(m, one(found[1] as string, args))
    at = ITEM.lastIndex
  }
  if (text.slice(at).trim() !== "") throw new GraphicError(`A transform could not be read: "${text.slice(0, 60)}"`)
  return m
}
