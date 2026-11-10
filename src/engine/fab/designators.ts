// Where each part's designator goes on the silkscreen. A designator sits just outside its courtyard, on the first side
// (above, below, left, right) where its text overlaps no pad's mask opening on that side of the board and no other
// designator; when every side is taken it stays above. A designator a person placed with pcbNameAt keeps its place.
// Either way, a designator that still covers pads or another designator gives a warning naming them, since the board
// house clips silkscreen off the pads. Pure.
import type { Point } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PcbLayout, PlacedFootprint, WorldPad } from "../pcb.js"
import type { FabricationProfile } from "../rules/schema.js"
import { textWidth } from "./stroke-font.js"

/** The silkscreen line width, in mm: JLCPCB's minimum legible line. */
export const SILK_WIDTH = 0.15
/** The silkscreen designator's height, in mm: JLCPCB's minimum legible character height. */
export const DESIGNATOR_HEIGHT = 1
/** The mask opening's growth past each pad when the profile sets none, in mm. */
export const DEFAULT_MASK_EXPANSION = 0.05

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface DesignatorPlacement {
  component: string
  side: "top" | "bottom"
  /** The middle of the designator's text. */
  at: Point
  /** The parts whose mask openings the text still covers, in designator order. */
  coversPads: string[]
  /** The other designators the text still covers, in designator order. */
  coversDesignators: string[]
}

const overlap = (a: Box, b: Box) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY

/** The box the designator's ink covers when centred on `at`, the stroke's half width included. */
function textBox(text: string, at: Point): Box {
  const halfWidth = textWidth(text, DESIGNATOR_HEIGHT) / 2 + SILK_WIDTH / 2
  const halfHeight = DESIGNATOR_HEIGHT / 2 + SILK_WIDTH / 2
  return { minX: at.x - halfWidth, minY: at.y - halfHeight, maxX: at.x + halfWidth, maxY: at.y + halfHeight }
}

/** The box around a pad's mask opening, turned with the pad: the pad grown by the expansion on every side. */
function maskBox(pad: WorldPad, expansion: number): Box {
  const radians = (pad.rotation * Math.PI) / 180
  const [cos, sin] = [Math.abs(Math.cos(radians)), Math.abs(Math.sin(radians))]
  const [w, h] = [pad.width / 2 + expansion, pad.height / 2 + expansion]
  const [dx, dy] = pad.shape === "circle" ? [w, w] : [w * cos + h * sin, w * sin + h * cos]
  return { minX: pad.x - dx, minY: pad.y - dy, maxX: pad.x + dx, maxY: pad.y + dy }
}

/** The places tried for a part's designator, in order: centred above, below, left and right of its courtyard. */
export function candidates(part: PlacedFootprint): Point[] {
  if (part.courtyard.length === 0) return [{ x: part.x, y: part.y }]
  const xs = part.courtyard.map((c) => c.x)
  const ys = part.courtyard.map((c) => c.y)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2]
  const [halfWidth, halfHeight] = [textWidth(part.component, DESIGNATOR_HEIGHT) / 2, DESIGNATOR_HEIGHT / 2]
  return [
    { x: cx, y: maxY + halfHeight },
    { x: cx, y: minY - halfHeight },
    { x: minX - halfWidth, y: cy },
    { x: maxX + halfWidth, y: cy },
  ]
}

const unique = (names: readonly string[]) => [...new Set(names)].sort(naturalCompare)

/**
 * Each part's designator with the parts whose pads, and the designators, it still covers. Designators placed by
 * pcbNameAt are set first, so the others go around them; the rest follow in the order of `parts`.
 */
export function designatorPlacements(parts: readonly PlacedFootprint[], expansion: number): DesignatorPlacement[] {
  const pinnedFirst = [...parts.filter((part) => part.nameAt), ...parts.filter((part) => !part.nameAt)].filter((part) => part.component !== "")
  const placed: { component: string; side: string; box: Box }[] = []
  const padsOn = (side: "top" | "bottom") =>
    parts.flatMap((part) => part.pads.filter((pad) => pad.layers === "through" || pad.layers === side).map((pad) => ({ component: part.component, box: maskBox(pad, expansion) })))
  const masks = { top: padsOn("top"), bottom: padsOn("bottom") }
  const covers = (part: PlacedFootprint, at: Point) => {
    const box = textBox(part.component, at)
    const pads = masks[part.side].filter((mask) => overlap(box, mask.box)).map((mask) => mask.component)
    const designators = placed.filter((other) => other.component !== part.component && other.side === part.side && overlap(box, other.box)).map((other) => other.component)
    return { pads, designators }
  }
  const chosen = pinnedFirst.map((part) => {
    const tries = part.nameAt ? [part.nameAt] : candidates(part)
    const free = tries.find((point) => {
      const { pads, designators } = covers(part, point)
      return pads.length === 0 && designators.length === 0
    })
    const at = free ?? (tries[0] as Point)
    placed.push({ component: part.component, side: part.side, box: textBox(part.component, at) })
    return { part, at }
  })
  // What each still covers is judged against every designator, those placed after it included.
  return chosen.map(({ part, at }) => {
    const { pads, designators } = covers(part, at)
    return { component: part.component, side: part.side, at, coversPads: unique(pads), coversDesignators: unique(designators) }
  })
}

/** The board with each part's designator anchor (`designatorAt`) set where the export draws it. */
export function withDesignators(pcb: PcbLayout, fabrication: FabricationProfile): PcbLayout {
  const placed = new Map(designatorPlacements(pcb.parts, fabrication.maskExpansion ?? DEFAULT_MASK_EXPANSION).map((p) => [p.component, p.at]))
  return { ...pcb, parts: pcb.parts.map((part) => (placed.has(part.component) ? { ...part, designatorAt: placed.get(part.component) as Point } : part)) }
}

/** Where the Studio draws a part's designator: pcbNameAt's place, else the anchor the design carries, else above the courtyard. */
export const designatorAnchor = (part: PlacedFootprint): Point => part.nameAt ?? part.designatorAt ?? (candidates(part)[0] as Point)

const possessive = (name: string) => `${name}'s`

/** A warning for each designator that covers pads or another designator, in designator order: "C1's silkscreen overlaps U1's pads". */
export function silkscreenWarnings(pcb: PcbLayout, fabrication: FabricationProfile): string[] {
  return designatorPlacements(pcb.parts, fabrication.maskExpansion ?? DEFAULT_MASK_EXPANSION)
    .filter((p) => p.coversPads.length > 0 || p.coversDesignators.length > 0)
    .sort((a, b) => naturalCompare(a.component, b.component))
    .map((p) => {
      const items = [
        ...(p.coversPads.length > 0 ? [`${listed(p.coversPads.map(possessive))} pads`] : []),
        ...(p.coversDesignators.length > 0 ? [`${listed(p.coversDesignators.map(possessive))} ${p.coversDesignators.length === 1 ? "designator" : "designators"}`] : []),
      ]
      return `${p.component}'s silkscreen overlaps ${items.join(" and ")}`
    })
}

/** "a", "a and b", "a, b and c". */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}
