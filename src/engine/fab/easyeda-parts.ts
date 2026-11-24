// A placed part as an EasyEDA Standard footprint (LIB): its pads with their nets, its silkscreen and body outlines, its
// designator (the P text) and its value (the N text, hidden), all in board coordinates as the editor stores them. The
// texts are drawn with copperflow's stroke font, as the Gerber legend draws them. Pure.
import type { Point } from "../model.js"
import type { PlacedFootprint, WorldPad } from "../pcb.js"
import { DESIGNATOR_HEIGHT, SILK_WIDTH, type DesignatorPlacement } from "./designators.js"
import { LAYER, libShape, padShape, textShape, trackShape, turner, type EasyedaPadShape, type TextKind } from "./easyeda-shapes.js"
import { textStrokes, textWidth } from "./stroke-font.js"

/** Hands out the document's object ids, "gge1", "gge2" and so on, in the order asked for. */
export type NextId = () => string

/** The net a net id is written as; "" for copper of no net. */
export type NetName = (net: string | undefined) => string

const PAD_SHAPE: Readonly<Record<WorldPad["shape"], EasyedaPadShape>> = { circle: "ELLIPSE", oval: "OVAL", rect: "RECT", roundrect: "RECT" }
const PAD_LAYER: Readonly<Record<WorldPad["layers"], number>> = { through: LAYER.multi, top: LAYER.top, bottom: LAYER.bottom }
const QUARTER = 90
const FULL_TURN = 360

/** A pad as a PAD shape; a rounded rectangle is written as a plain one, the format having no rounded pad. */
export function padString(pad: WorldPad, netName: NetName, id: string): string {
  return padShape({
    shape: PAD_SHAPE[pad.shape],
    at: pad,
    width: pad.width,
    height: pad.shape === "circle" ? pad.width : pad.height,
    layer: PAD_LAYER[pad.layers],
    net: netName(pad.net),
    number: pad.number,
    rotation: pad.rotation,
    ...(pad.drill ? { drill: pad.drill } : {}),
    id,
  })
}

/**
 * Where a text starts, in mm: the left end of its baseline, turned `rotation` degrees about its centre, then mirrored
 * left to right about the centre when `mirrored`; the editor puts a text's x, y there.
 */
export function textStart(center: Point, width: number, height: number, rotation: number, mirrored: boolean): Point {
  const p = turner(rotation)({ x: -width / 2, y: -height / 2 })
  return { x: center.x + (mirrored ? -p.x : p.x), y: center.y + p.y }
}

interface FootprintText {
  kind: TextKind
  text: string
  at: Point
  /** 0 reads left to right, 90 from the bottom up. */
  turn: 0 | 90
  side: "top" | "bottom"
  shown: boolean
}

/**
 * A designator or value text, `DESIGNATOR_HEIGHT` tall and centred on `at`, as the Gerber legend draws a designator. On
 * the bottom it is mirrored; a quarter-turned one there reads from the top down, so it is written turned three quarters.
 */
function footprintText(t: FootprintText, id: string): string {
  const bottom = t.side === "bottom"
  const turned = t.turn === QUARTER
  const rotation = turned ? (bottom ? FULL_TURN - QUARTER : QUARTER) : 0
  return textShape({
    kind: t.kind,
    start: textStart(t.at, textWidth(t.text, DESIGNATOR_HEIGHT), DESIGNATOR_HEIGHT, rotation, bottom),
    lineWidth: SILK_WIDTH,
    rotation,
    mirrored: bottom,
    layer: bottom ? LAYER.bottomSilk : LAYER.topSilk,
    height: DESIGNATOR_HEIGHT,
    text: t.text,
    strokes: textStrokes(t.text, t.at, DESIGNATOR_HEIGHT, bottom, turned),
    shown: t.shown,
    id,
  })
}

export interface PartInput {
  part: PlacedFootprint
  /** Where the fabrication export prints its designator; absent when the part's designator is hidden. */
  designator?: DesignatorPlacement
  /** What the designator reads when it is hidden: the part's printed name. */
  name: string
  /** The part's value, written as its hidden name text; the footprint's name when it has none. */
  value?: string
}

/** The part as a LIB shape; none for a part without a footprint, which has no pads to write. */
export function partString(input: PartInput, netName: NetName, nextId: NextId): string | undefined {
  const { part, designator } = input
  const footprint = part.footprint
  if (footprint === undefined) return undefined
  const bottom = part.side === "bottom"
  const id = nextId()
  const lines = (polylines: readonly Point[][], layer: number) =>
    polylines.filter((line) => line.length > 1).map((points) => trackShape({ width: SILK_WIDTH, layer, net: "", points, id: nextId() }))
  const center = { x: part.x, y: part.y }
  const children = [
    footprintText(designator ? { kind: "P", text: designator.text, at: designator.at, turn: designator.rotation, side: part.side, shown: true } : { kind: "P", text: input.name, at: center, turn: 0, side: part.side, shown: false }, nextId()),
    footprintText({ kind: "N", text: input.value ?? footprint.name, at: center, turn: 0, side: part.side, shown: false }, nextId()),
    ...lines(part.silkscreen, bottom ? LAYER.bottomSilk : LAYER.topSilk),
    ...lines(part.fabrication, bottom ? LAYER.bottomAssembly : LAYER.topAssembly),
    ...part.pads.map((pad) => padString(pad, netName, nextId())),
  ]
  const attributes: [string, string][] = [
    ["package", footprint.name],
    ["Contributor", "copperflow"],
    ...(input.value !== undefined ? ([["Value", input.value]] as [string, string][]) : []),
  ]
  return libShape({ at: center, attributes, rotation: part.rotation, side: part.side, id, children })
}
