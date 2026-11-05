// The box a tag-style net label occupies on the sheet; the renderer draws it and the wire tool hits it.
import type { NetLabel } from "../../../src/engine/schematic.js"
import type { Box, Point } from "./geometry.js"

export const NET_LABEL_TEXT = 0.16
const TAG_THICKNESS = NET_LABEL_TEXT * 1.5
const TAG_CHAR = 0.62
const OUTWARD: Record<NetLabel["side"], Point> = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, top: { x: 0, y: 1 }, bottom: { x: 0, y: -1 } }

export interface LabelTag {
  middle: Point
  box: Box
  /** Whether the tag stands upright (its long side is vertical). */
  upright: boolean
}

/** The tag reaches outward from the label's anchor, long enough for its text. */
export function labelTag(label: Pick<NetLabel, "at" | "side" | "text">): LabelTag {
  const out = OUTWARD[label.side]
  const length = label.text.length * NET_LABEL_TEXT * TAG_CHAR + TAG_THICKNESS
  const upright = out.x === 0
  const middle = { x: label.at.x + (out.x * length) / 2, y: label.at.y + (out.y * length) / 2 }
  const [w, h] = upright ? [TAG_THICKNESS, length] : [length, TAG_THICKNESS]
  return { middle, upright, box: { minX: middle.x - w / 2, minY: middle.y - h / 2, maxX: middle.x + w / 2, maxY: middle.y + h / 2 } }
}
