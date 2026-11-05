import { line, pt, text, type Shape } from "./types.js"

/** Bars below the attachment point, which is the origin. */
export function groundSymbol(): Shape[] {
  return [line([0, 0], [0, -0.1]), line([-0.15, -0.1], [0.15, -0.1]), line([-0.1, -0.15], [0.1, -0.15]), line([-0.05, -0.2], [0.05, -0.2])]
}

/** A bar above the attachment point, which is the origin, with the net name over it. */
export function powerSymbol(name: string): Shape[] {
  return [line([0, 0], [0, 0.1]), line([-0.1, 0.1], [0.1, 0.1]), text(name, pt(0, 0.2), "center", "value")]
}
