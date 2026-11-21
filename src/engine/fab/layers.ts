// What each Gerber file holds, from the built board: copper (pours, pads, tracks, vias) per copper layer, solder mask openings
// (pads grown by the mask expansion; vias are tented), paste (SMD pads only, shrunk by the paste reduction),
// silkscreen (footprint outlines, designators, the board's own texts and drawings) and the board outline; a drawing on a
// mask layer is an opening there. Keepouts are not exported; the mask and paste
// ignore the pours. Pure.
import { boardCopperLayers, type CopperLayer } from "../../core/layout-file.js"
import { viaSpan } from "../copper.js"
import type { Point } from "../model.js"
import type { PcbLayout, PlacedFootprint, WorldPad } from "../pcb.js"
import { pathArea, regions, toPath, toPoints } from "../pour/clip.js"
import type { FabricationProfile } from "../rules/schema.js"
import { DEFAULT_MASK_EXPANSION, DESIGNATOR_HEIGHT, designatorPlacements, silkClearance, SILK_WIDTH } from "./designators.js"
import { writeGerber, type GerberLayer, type GerberObject } from "./gerber.js"
import { graphicObjects } from "./graphic-objects.js"
import { fabFileName, GERBER_LAYERS, type GerberLayerName } from "./names.js"
import { silkTextLineWidth, silkTextStrokes } from "./silk-text-strokes.js"
import { textStrokes } from "./stroke-font.js"

export { DEFAULT_MASK_EXPANSION, DESIGNATOR_HEIGHT, SILK_WIDTH }
/** The paste's shrink inside each SMD pad when the profile sets none, in mm. */
export const DEFAULT_PASTE_REDUCTION = 0
/** The board outline's line width, in mm. */
export const OUTLINE_WIDTH = 0.1

type Side = "top" | "bottom"
const SIDES: readonly Side[] = ["top", "bottom"]
const ANGLE_TOLERANCE = 1e-9

const COPPER_NAME: Readonly<Record<CopperLayer, GerberLayerName>> = { top: "F_Cu", inner1: "In1_Cu", inner2: "In2_Cu", bottom: "B_Cu" }
const SIDE_KEY: Readonly<Record<Side, "F" | "B">> = { top: "F", bottom: "B" }
const SIDE_X2: Readonly<Record<Side, "Top" | "Bot">> = { top: "Top", bottom: "Bot" }

const isSmd = (pad: WorldPad) => pad.drill === undefined && pad.layers !== "through"
const padOnSide = (pad: WorldPad, side: Side) => pad.layers === "through" || pad.layers === side

/**
 * A pad's copper as a flash or a region, its size changed by `grow` on every side (negative shrinks); none when nothing
 * is left. Upright or quarter-turned rectangles and ovals are the R and O apertures, other angles a region of their
 * outline; a rounded rectangle is the RoundRect macro only while its corner radius is above 0, else a rectangle.
 */
export function padObject(pad: WorldPad, grow = 0, fn?: string): GerberObject | undefined {
  const width = pad.width + 2 * grow
  const height = pad.height + 2 * grow
  if (width <= 0 || height <= 0) return undefined
  const at = { x: pad.x, y: pad.y }
  const turn = (((pad.rotation % 360) + 360) % 360) % 180
  const square = Math.abs(turn % 90) < ANGLE_TOLERANCE || Math.abs((turn % 90) - 90) < ANGLE_TOLERANCE
  const upright = Math.abs(turn - 90) < ANGLE_TOLERANCE ? { width: height, height: width } : { width, height }
  const extra = fn === undefined ? {} : { function: fn }
  const plainRect = (): GerberObject =>
    square ? { kind: "flash", at, aperture: { shape: "rect", ...upright }, ...extra } : { kind: "region", points: rectCorners(at, width, height, pad.rotation), ...extra }
  switch (pad.shape) {
    case "circle":
      return { kind: "flash", at, aperture: { shape: "circle", diameter: width }, ...extra }
    case "rect":
      return plainRect()
    case "oval":
      if (square) return { kind: "flash", at, aperture: { shape: "obround", ...upright }, ...extra }
      return { kind: "region", points: stadium(at, width, height, pad.rotation), ...extra }
    case "roundrect": {
      const radius = Math.min(Math.max((pad.cornerRadius ?? 0) + grow, 0), width / 2, height / 2)
      if (radius <= 0) return plainRect()
      const sized = square ? { ...upright, rotation: 0 } : { width, height, rotation: turn }
      return { kind: "flash", at, aperture: { shape: "roundrect", radius, ...sized }, ...extra }
    }
  }
}

/** The points of each round end of a turned oval's outline, its first, middle (the tip) and last included. */
const STADIUM_END_POINTS = 11

/** A `width` by `height` oval turned `rotation` degrees about `at`, as the corners of its outline: two half circles. */
function stadium(at: Point, width: number, height: number, rotation: number): Point[] {
  const radius = Math.min(width, height) / 2
  const reach = Math.max(width, height) / 2 - radius
  // Drawn along x, then turned a further quarter when the oval is taller than wide.
  const radians = ((rotation + (height > width ? 90 : 0)) * Math.PI) / 180
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)]
  const end = (centre: number, from: number) =>
    Array.from({ length: STADIUM_END_POINTS }, (_, i) => {
      const angle = from + (Math.PI * i) / (STADIUM_END_POINTS - 1)
      return { x: centre + radius * Math.cos(angle), y: radius * Math.sin(angle) }
    })
  return [...end(reach, -Math.PI / 2), ...end(-reach, Math.PI / 2)].map(({ x, y }) => ({ x: at.x + x * cos - y * sin, y: at.y + x * sin + y * cos }))
}

function rectCorners(at: Point, width: number, height: number, rotation: number): Point[] {
  const radians = (rotation * Math.PI) / 180
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)]
  const corners = [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2],
  ] as const
  return corners.map(([x, y]) => ({ x: at.x + x * cos - y * sin, y: at.y + x * sin + y * cos }))
}

const pads = (parts: readonly PlacedFootprint[]) => parts.flatMap((part) => part.pads)
/** The X2 aperture function of a pad, on copper, mask and paste alike. */
const padFunction = (pad: WorldPad) => (isSmd(pad) ? "SMDPad,CuDef" : "ComponentPad")
/** The X2 aperture function of silkscreen lines: the specification has none of its own for a legend. */
const LEGEND_FUNCTION = "Other,Legend"
const present = <T>(item: T | undefined): item is T => item !== undefined

/**
 * The pours' fills on the layer as regions: the fills united, then each piece dark and its holes (the reliefs' gaps,
 * the clearance round other nets' copper) clear, largest piece first so a piece inside another's hole is drawn after
 * that hole is cleared. They come before everything else on the layer, which is drawn dark over them.
 */
function pourObjects(pcb: PcbLayout, layer: CopperLayer): GerberObject[] {
  const paths = pcb.pours.filter((pour) => pour.layer === layer).flatMap((pour) => pour.polygons.flatMap((polygon) => [toPath(polygon.outer), ...polygon.holes.map(toPath)]))
  if (paths.length === 0) return []
  const pieces = regions(paths).sort((a, b) => Math.abs(pathArea(b.outer)) - Math.abs(pathArea(a.outer)))
  return pieces.flatMap((piece): GerberObject[] => [
    { kind: "region", points: toPoints(piece.outer), function: "Conductor" },
    ...piece.holes.map((hole): GerberObject => ({ kind: "region", points: toPoints(hole), polarity: "clear" })),
  ])
}

/**
 * The drawings on this copper layer: each area one dark region whose holes are joined to its outline by cut-in lines
 * (no clear region, so nothing else on the layer can be erased by a drawing's hole), then their lines; after the
 * pours, whose clear regions would erase them otherwise.
 */
function drawingCopper(pcb: PcbLayout, layer: CopperLayer): GerberObject[] {
  const here = (pcb.graphics ?? []).filter((graphic) => graphic.layer === layer)
  return here.flatMap((graphic): GerberObject[] => [
    ...graphic.areas.map((area): GerberObject => ({ kind: "region", points: withCutIns(area), function: "Conductor" })),
    ...graphic.lines.filter((line) => line.points.length > 0).map((line): GerberObject => ({ kind: "draw", points: line.points, width: line.width, function: "Conductor" })),
  ])
}

const wound = (ring: readonly Point[], counterClockwise: boolean): Point[] => {
  const twice = ring.reduce((sum, a, i) => {
    const b = ring[(i + 1) % ring.length] as Point
    return sum + a.x * b.y - b.x * a.y
  }, 0)
  return twice > 0 === counterClockwise ? [...ring] : [...ring].reverse()
}

/**
 * One contour for an area with holes: the outline counter-clockwise, and each hole, clockwise, entered from the
 * outline's nearest corner and left back to it along the same line, so the hole stays open under the non-zero rule.
 */
export function withCutIns(area: { outer: Point[]; holes: Point[][] }): Point[] {
  return area.holes.reduce((ring, raw) => {
    const hole = wound(raw, false)
    let [best, at, from] = [Infinity, 0, 0]
    hole.forEach((h, j) =>
      ring.forEach((o, i) => {
        const d = (o.x - h.x) ** 2 + (o.y - h.y) ** 2
        if (d < best) [best, at, from] = [d, i, j]
      }),
    )
    const loop = [...hole.slice(from), ...hole.slice(0, from), hole[from] as Point]
    return [...ring.slice(0, at + 1), ...loop, ...ring.slice(at)]
  }, wound(area.outer, true))
}

function copperObjects(pcb: PcbLayout, layer: CopperLayer): GerberObject[] {
  const padCopper = pads(pcb.parts)
    .filter((pad) => pad.layers === "through" || pad.layers === layer)
    .map((pad) => padObject(pad, 0, padFunction(pad)))
  const tracks = pcb.tracks
    .filter((track) => track.layer === layer && track.missingLayer === undefined)
    .map((track): GerberObject => ({ kind: "draw", points: track.points, width: track.width, function: "Conductor" }))
  const vias = pcb.vias
    .filter((via) => via.missingLayer === undefined && viaSpan(via).has(layer))
    .map((via): GerberObject => ({ kind: "flash", at: via.at, aperture: { shape: "circle", diameter: via.diameter }, function: "ViaPad" }))
  return [...pourObjects(pcb, layer), ...drawingCopper(pcb, layer), ...padCopper.filter(present), ...tracks, ...vias]
}

function silkObjects(pcb: PcbLayout, side: Side, expansion: number, clearance: number): GerberObject[] {
  const designators = designatorPlacements(pcb, expansion, clearance).filter((placed) => placed.side === side)
  const draw = (width: number) => (points: Point[]): GerberObject => ({ kind: "draw", points, width, function: LEGEND_FUNCTION })
  const texts = (pcb.silkTexts ?? []).filter((text) => text.layer === side).flatMap((text) => silkTextStrokes(text).map(draw(silkTextLineWidth(text.height))))
  const drawings = graphicObjects(pcb.graphics, `${side}-silkscreen`, LEGEND_FUNCTION)
  return [
    ...drawings.areas,
    ...[
      ...pcb.parts.filter((part) => part.side === side).flatMap((part) => part.silkscreen),
      ...designators.flatMap((placed) => textStrokes(placed.text, placed.at, DESIGNATOR_HEIGHT, side === "bottom", placed.rotation === 90)),
    ]
      .filter((line) => line.length > 0)
      .map(draw(SILK_WIDTH)),
    ...texts,
    ...drawings.lines,
  ]
}

/** The solder mask openings on a side: the board's drawings on that mask (areas first), then the pads grown by the expansion. */
function maskObjects(pcb: PcbLayout, side: Side, onSide: readonly WorldPad[], expansion: number): GerberObject[] {
  const drawings = graphicObjects(pcb.graphics, `${side}-mask`)
  return [...drawings.areas, ...onSide.map((pad) => padObject(pad, expansion, padFunction(pad))).filter(present), ...drawings.lines]
}

function outlineObjects(pcb: PcbLayout): GerberObject[] {
  const outline = pcb.board?.outline ?? []
  const first = outline[0]
  if (first === undefined) return []
  return [{ kind: "draw", points: [...outline, first], width: OUTLINE_WIDTH, function: "Profile" }]
}

/** Each Gerber file's content, in the order of GERBER_LAYERS; the inner copper layers only on a 4-layer board. */
export function gerberLayers(pcb: PcbLayout, fabrication: FabricationProfile): { name: GerberLayerName; layer: GerberLayer }[] {
  const copper = boardCopperLayers(pcb.board?.layers ?? 2)
  const expansion = fabrication.maskExpansion ?? DEFAULT_MASK_EXPANSION
  const reduction = fabrication.pasteReduction ?? DEFAULT_PASTE_REDUCTION
  const layers = new Map<GerberLayerName, GerberLayer>()
  const ordered = (["top", "inner1", "inner2", "bottom"] as const).filter((layer) => copper.includes(layer))
  ordered.forEach((layer, i) => {
    const position = layer === "top" ? "Top" : layer === "bottom" ? "Bot" : "Inr"
    layers.set(COPPER_NAME[layer], { fileFunction: `Copper,L${i + 1},${position}`, polarity: "Positive", objects: copperObjects(pcb, layer) })
  })
  for (const side of SIDES) {
    const onSide = pads(pcb.parts).filter((pad) => padOnSide(pad, side))
    const mask = maskObjects(pcb, side, onSide, expansion)
    const paste = onSide.filter(isSmd).map((pad) => padObject(pad, -reduction, padFunction(pad))).filter(present)
    layers.set(`${SIDE_KEY[side]}_Mask`, { fileFunction: `Soldermask,${SIDE_X2[side]}`, polarity: "Negative", objects: mask })
    layers.set(`${SIDE_KEY[side]}_Paste`, { fileFunction: `Paste,${SIDE_X2[side]}`, polarity: "Positive", objects: paste })
    layers.set(`${SIDE_KEY[side]}_Silkscreen`, { fileFunction: `Legend,${SIDE_X2[side]}`, polarity: "Positive", objects: silkObjects(pcb, side, expansion, silkClearance(fabrication)) })
  }
  layers.set("Edge_Cuts", { fileFunction: "Profile,NP", polarity: "Positive", objects: outlineObjects(pcb) })
  return GERBER_LAYERS.flatMap((name) => {
    const layer = layers.get(name)
    return layer === undefined ? [] : [{ name, layer }]
  })
}

/** The Gerber files of the board for the design `name`: each file's name and text. `created` is the X2 creation date. */
export function gerberFiles(pcb: PcbLayout, fabrication: FabricationProfile, name: string, created: Date): { file: string; text: string }[] {
  return gerberLayers(pcb, fabrication).map(({ name: layer, layer: content }) => ({ file: fabFileName(name, layer), text: writeGerber(content, created) }))
}
