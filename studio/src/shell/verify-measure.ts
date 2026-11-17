// The Verify screen's measure and pad description: two picked pads, centre to centre and the gap between their nearest
// edges, and what a hovered or focused pad is. Pure.
import type { Pad } from "../../../src/engine/footprints/types.js"
import { byNumber, edgeGap, mm, padExtent } from "./verify-figures.js"

export interface Measure {
  dx: number
  dy: number
  straight: number
  gap: number
}

const round = (value: number) => Number(mm(value))

/** From pad `a` to pad `b`, in mm with three decimals at most. */
export function measurePads(a: Pad, b: Pad): Measure {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  return { dx: round(dx), dy: round(dy), straight: round(Math.hypot(dx, dy)), gap: round(edgeGap(a, b)) }
}

export function measureText(a: Pad, b: Pad): string {
  const m = measurePads(a, b)
  return `Pad ${a.number} to pad ${b.number}: dx ${m.dx} mm, dy ${m.dy} mm, straight ${m.straight} mm, gap ${m.gap} mm`
}

/** "Pad 1, VCC: x -3.81 mm, y 0 mm, 1.7 × 1.7 mm, drill 1 mm". */
export function padInfo(pad: Pad, pin: string | undefined): string {
  const size = padExtent(pad)
  const drill = pad.drill === undefined ? "" : pad.drill.width === pad.drill.height ? `, drill ${mm(pad.drill.width)} mm` : `, drill ${mm(pad.drill.width)} × ${mm(pad.drill.height)} mm`
  return `Pad ${pad.number}${pin === undefined ? "" : `, ${pin}`}: x ${mm(pad.x)} mm, y ${mm(pad.y)} mm, ${mm(size.width)} × ${mm(size.height)} mm${drill}`
}

/** The pads in pad-number order, the order the keyboard visits them. */
export function padsInOrder<T extends Pick<Pad, "number">>(pads: readonly T[]): T[] {
  return [...pads].sort((a, b) => byNumber(a.number, b.number))
}
