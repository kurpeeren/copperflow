// SVG-style paths as EasyEDA writes them (M, L, H, V, A, Z, absolute or relative), turned into polylines in the
// document's own units. Arcs become short straight segments.

export interface RawPoint {
  x: number
  y: number
}

/** The largest angle one straight segment of an arc covers, in degrees. */
const ARC_STEP_DEGREES = 10

const TOKEN = /[MLHVAZmlhvaz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g

/** The polylines of a path: one per subpath, a closed one ending on its first point. */
export function pathPolylines(path: string): RawPoint[][] {
  const tokens = path.match(TOKEN) ?? []
  const lines: RawPoint[][] = []
  let current: RawPoint[] = []
  let at: RawPoint = { x: 0, y: 0 }
  let command = ""
  let index = 0
  const number = (): number => {
    const value = Number(tokens[index++])
    if (!Number.isFinite(value)) throw new Error(`path "${path.slice(0, 60)}" has a command without its numbers`)
    return value
  }
  const finish = () => {
    if (current.length >= 2) lines.push(current)
    current = []
  }
  while (index < tokens.length) {
    const token = tokens[index] as string
    if (/^[A-Za-z]$/.test(token)) {
      command = token
      index++
      if (command === "Z" || command === "z") {
        const first = current[0]
        if (first) current.push({ ...first })
        if (first) at = { ...first }
        finish()
        continue
      }
    }
    const relative = command === command.toLowerCase()
    const base = relative ? at : { x: 0, y: 0 }
    switch (command.toUpperCase()) {
      case "M":
        finish()
        at = { x: base.x + number(), y: base.y + number() }
        current = [at]
        // Further pairs after a move are lines.
        command = relative ? "l" : "L"
        break
      case "L":
        at = { x: base.x + number(), y: base.y + number() }
        current.push(at)
        break
      case "H":
        at = { x: (relative ? at.x : 0) + number(), y: at.y }
        current.push(at)
        break
      case "V":
        at = { x: at.x, y: (relative ? at.y : 0) + number() }
        current.push(at)
        break
      case "A": {
        const [rx, ry, rotation, large, sweep] = [number(), number(), number(), number(), number()]
        const end = { x: base.x + number(), y: base.y + number() }
        if (current.length === 0) current = [at]
        current.push(...arcPoints(at, end, rx, ry, rotation, large !== 0, sweep !== 0))
        at = end
        break
      }
      default:
        throw new Error(`path "${path.slice(0, 60)}" uses "${command || token}", which copperflow does not read`)
    }
  }
  finish()
  return lines
}

/**
 * The points after `from` along an SVG elliptical arc to `to` (the endpoint form of SVG 1.1 F.6.5), ending on `to`.
 * A zero radius or equal ends make a straight line.
 */
export function arcPoints(from: RawPoint, to: RawPoint, rxIn: number, ryIn: number, rotationDegrees: number, large: boolean, sweep: boolean): RawPoint[] {
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  if (rx === 0 || ry === 0 || (from.x === to.x && from.y === to.y)) return [to]
  const phi = (rotationDegrees * Math.PI) / 180
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)]
  const dx = (from.x - to.x) / 2
  const dy = (from.y - to.y) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  const scale = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (scale > 1) {
    rx *= Math.sqrt(scale)
    ry *= Math.sqrt(scale)
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator))
  const cx1 = (factor * rx * y1) / ry
  const cy1 = (-factor * ry * x1) / rx
  const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2
  const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  if (sweep && delta < 0) delta += 2 * Math.PI
  const steps = Math.max(2, Math.ceil(Math.abs(delta) / ((ARC_STEP_DEGREES * Math.PI) / 180)))
  const points: RawPoint[] = []
  for (let step = 1; step < steps; step++) {
    const t = start + (delta * step) / steps
    const ex = rx * Math.cos(t)
    const ey = ry * Math.sin(t)
    points.push({ x: cos * ex - sin * ey + cx, y: sin * ex + cos * ey + cy })
  }
  points.push(to)
  return points
}

/** A circle as a closed polyline. */
export function circlePoints(centre: RawPoint, radius: number): RawPoint[] {
  const steps = 360 / ARC_STEP_DEGREES
  const points: RawPoint[] = []
  for (let step = 0; step <= steps; step++) {
    const t = (2 * Math.PI * step) / steps
    points.push({ x: centre.x + radius * Math.cos(t), y: centre.y + radius * Math.sin(t) })
  }
  return points
}
