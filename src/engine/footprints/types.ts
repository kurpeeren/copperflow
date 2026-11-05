import type { Point } from "../model.js"

export type PadShape = "rect" | "roundrect" | "circle" | "oval"

/** A copper pad. Lengths in mm, seen from the top, `rotation` in degrees counter-clockwise. */
export interface Pad {
  /** Pad "1" belongs to pin 1. */
  number: string
  shape: PadShape
  x: number
  y: number
  /** Size along x before rotation. */
  width: number
  /** Size along y before rotation. */
  height: number
  rotation: number
  /** Footprints are made on "top"; a part placed on the bottom side gets mirrored copies. */
  layers: "top" | "bottom" | "through"
  /** Through pads only; width and height are equal for a round hole. */
  drill?: { width: number; height: number }
  cornerRadius?: number
}

/**
 * A footprint in mm with its origin at the part centre, y up, seen from the top, at rotation 0.
 * Generated footprints are frozen: build new objects to change one.
 */
export interface Footprint {
  name: string
  pads: Pad[]
  /** A closed polygon; the last corner joins the first. */
  courtyard: Point[]
  /** Polylines. */
  silkscreen: Point[][]
  /** Polylines that outline the body. */
  fabrication: Point[][]
  /** Where the numbers come from, for example "IPC-7351B nominal, EIA 0603". */
  origin: string
}
