// What each Gerber file holds, from the built board: copper (pads, tracks, vias) per copper layer, solder mask openings
// (pads grown by the mask expansion; vias are tented), paste (SMD pads only, shrunk by the paste reduction),
// silkscreen (footprint outlines and designators) and the board outline. Keepouts are not exported. Pure.
import { boardCopperLayers, type CopperLayer } from "../../core/layout-file.js"
import { viaSpan } from "../copper.js"
import type { Point } from "../model.js"
import type { PcbLayout, PlacedFootprint, WorldPad } from "../pcb.js"
import type { FabricationProfile } from "../rules/schema.js"
import { writeGerber, type GerberLayer, type GerberObject } from "./gerber.js"
import { fabFileName, GERBER_LAYERS, type GerberLayerName } from "./names.js"
import { textStrokes } from "./stroke-font.js"

/** The mask opening's growth past each pad when the profile sets none, in mm. */
export const DEFAULT_MASK_EXPANSION = 0.05
/** The paste's shrink inside each SMD pad when the profile sets none, in mm. */
export const DEFAULT_PASTE_REDUCTION = 0
/** The silkscreen line width, in mm: JLCPCB's minimum legible line. */
export const SILK_WIDTH = 0.15
/** The silkscreen designator's height, in mm: JLCPCB's minimum legible character height. */
export const DESIGNATOR_HEIGHT = 1
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

/** A pad's copper as a flash or a region, its size changed by `grow` on every side (negative shrinks); none when nothing is left. */
export function padObject(pad: WorldPad, grow = 0, fn?: string): GerberObject | undefined {
  const width = pad.width + 2 * grow
  const height = pad.height + 2 * grow
  if (width <= 0 || height <= 0) return undefined
  const at = { x: pad.x, y: pad.y }
  const turn = (((pad.rotation % 360) + 360) % 360) % 180
  const square = Math.abs(turn % 90) < ANGLE_TOLERANCE || Math.abs((turn % 90) - 90) < ANGLE_TOLERANCE
  const upright = Math.abs(turn - 90) < ANGLE_TOLERANCE ? { width: height, height: width } : { width, height }
  const extra = fn === undefined ? {} : { function: fn }
  switch (pad.shape) {
    case "circle":
      return { kind: "flash", at, aperture: { shape: "circle", diameter: width }, ...extra }
    case "rect":
      return square ? { kind: "flash", at, aperture: { shape: "rect", ...upright }, ...extra } : { kind: "region", points: rectCorners(at, width, height, pad.rotation), ...extra }
    case "oval":
      if (square) return { kind: "flash", at, aperture: { shape: "obround", ...upright }, ...extra }
      return { kind: "flash", at, aperture: { shape: "roundrect", width, height, radius: Math.min(width, height) / 2, rotation: turn }, ...extra }
    case "roundrect": {
      const radius = Math.min(Math.max((pad.cornerRadius ?? 0) + grow, 0), width / 2, height / 2)
      const sized = square ? { ...upright, rotation: 0 } : { width, height, rotation: turn }
      return { kind: "flash", at, aperture: { shape: "roundrect", radius, ...sized }, ...extra }
    }
  }
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
  return [...padCopper.filter(present), ...tracks, ...vias]
}

/** Where a part's designator goes: where pcbNameAt puts it, else centred just above the courtyard's top edge. */
function designatorAt(part: PlacedFootprint): Point {
  if (part.nameAt) return part.nameAt
  const xs = part.courtyard.map((c) => c.x)
  const ys = part.courtyard.map((c) => c.y)
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.max(...ys) + DESIGNATOR_HEIGHT / 2 }
}

function silkObjects(parts: readonly PlacedFootprint[], side: Side): GerberObject[] {
  return parts
    .filter((part) => part.side === side)
    .flatMap((part) => [...part.silkscreen, ...textStrokes(part.component, designatorAt(part), DESIGNATOR_HEIGHT, side === "bottom")])
    .filter((line) => line.length > 0)
    .map((points): GerberObject => ({ kind: "draw", points, width: SILK_WIDTH, function: LEGEND_FUNCTION }))
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
    const mask = onSide.map((pad) => padObject(pad, expansion, padFunction(pad))).filter(present)
    const paste = onSide.filter(isSmd).map((pad) => padObject(pad, -reduction, padFunction(pad))).filter(present)
    layers.set(`${SIDE_KEY[side]}_Mask`, { fileFunction: `Soldermask,${SIDE_X2[side]}`, polarity: "Negative", objects: mask })
    layers.set(`${SIDE_KEY[side]}_Paste`, { fileFunction: `Paste,${SIDE_X2[side]}`, polarity: "Positive", objects: paste })
    layers.set(`${SIDE_KEY[side]}_Silkscreen`, { fileFunction: `Legend,${SIDE_X2[side]}`, polarity: "Positive", objects: silkObjects(pcb.parts, side) })
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
