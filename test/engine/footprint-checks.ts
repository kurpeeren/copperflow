// Checks shared by the tests of the generated package families.
import { expect } from "vitest"
import { generateFootprint } from "../../src/engine/footprints/index.js"
import type { Footprint, Pad } from "../../src/engine/footprints/types.js"
import type { Point } from "../../src/engine/model.js"

export const EPS = 1e-9
/** The engine plan's silkscreen-to-copper clearance. */
export const SILK_CLEARANCE = 0.15

export function footprint(text: string): Footprint {
  const result = generateFootprint(text)
  if ("error" in result) throw new Error(result.error)
  return result
}

export function refused(text: string): void {
  expect(generateFootprint(text)).toEqual({ error: `copperflow cannot make footprint "${text}" yet` })
}

export function pad(fp: Footprint, number: string | number): Pad {
  const found = fp.pads.find((p) => p.number === String(number))
  if (!found) throw new Error(`${fp.name} has no pad ${number}`)
  return found
}

interface Box {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** A pad's bounding box (pads here are never turned). */
export function box(p: Pad): Box {
  return { minX: p.x - p.width / 2, maxX: p.x + p.width / 2, minY: p.y - p.height / 2, maxY: p.y + p.height / 2 }
}

function segments(lines: readonly Point[][]): [Point, Point][] {
  return lines.flatMap((line) => line.slice(1).map((end, i) => [line[i] as Point, end] as [Point, Point]))
}

/** Distance from a point to a pad: to its box, or to its circle for a round pad. */
function pointToPad(x: number, y: number, p: Pad): number {
  if (p.shape === "circle") return Math.max(0, Math.hypot(x - p.x, y - p.y) - p.width / 2)
  const b = box(p)
  return Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minY - y, 0, y - b.maxY))
}

/** The smallest distance from any silkscreen line to any pad, sampled along each line. */
export function silkToPads(fp: Footprint): number {
  let best = Infinity
  for (const [a, b] of segments(fp.silkscreen)) {
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const steps = Math.max(8, Math.ceil(length / 0.005))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = a.x + (b.x - a.x) * t
      const y = a.y + (b.y - a.y) * t
      for (const p of fp.pads) best = Math.min(best, pointToPad(x, y, p))
    }
  }
  return best
}

/** The courtyard's half sizes; generated courtyards are rectangles centred on the origin. */
export function courtyardHalf(fp: Footprint): { x: number; y: number } {
  return { x: Math.max(...fp.courtyard.map((p) => Math.abs(p.x))), y: Math.max(...fp.courtyard.map((p) => Math.abs(p.y))) }
}

/** The checks every generated footprint passes: the courtyard holds the pads and the body, silkscreen clears copper, pads apart. */
export function expectWellFormed(fp: Footprint): void {
  const half = courtyardHalf(fp)
  for (const p of fp.pads) {
    const b = box(p)
    expect(b.maxX).toBeLessThanOrEqual(half.x + EPS)
    expect(-b.minX).toBeLessThanOrEqual(half.x + EPS)
    expect(b.maxY).toBeLessThanOrEqual(half.y + EPS)
    expect(-b.minY).toBeLessThanOrEqual(half.y + EPS)
  }
  for (const point of fp.fabrication.flat()) {
    expect(Math.abs(point.x)).toBeLessThanOrEqual(half.x + EPS)
    expect(Math.abs(point.y)).toBeLessThanOrEqual(half.y + EPS)
  }
  expect(fp.silkscreen.length).toBeGreaterThan(0)
  expect(silkToPads(fp)).toBeGreaterThanOrEqual(SILK_CLEARANCE - 1e-6)
  if (fp.pads.length <= 400) {
    for (let i = 0; i < fp.pads.length; i++) {
      for (let j = i + 1; j < fp.pads.length; j++) {
        const a = box(fp.pads[i] as Pad)
        const b = box(fp.pads[j] as Pad)
        const apart = a.maxX <= b.minX + EPS || b.maxX <= a.minX + EPS || a.maxY <= b.minY + EPS || b.maxY <= a.minY + EPS
        expect(apart, `${fp.name}: pads ${fp.pads[i]?.number} and ${fp.pads[j]?.number} overlap`).toBe(true)
      }
    }
  }
}

/** Distances between pads n and n + 1 inside each run of `perRun` pads. */
export function neighbourDistances(fp: Footprint, perRun: number): number[] {
  const out: number[] = []
  for (let n = 1; n < fp.pads.length; n++) {
    if (n % perRun === 0) continue
    const a = fp.pads[n - 1] as Pad
    const b = fp.pads[n] as Pad
    out.push(Math.hypot(b.x - a.x, b.y - a.y))
  }
  return out
}
