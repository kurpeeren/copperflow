import type { ClassOf } from "../checks/copper-pieces.js"
import { padShape, type Shape } from "../checks/geometry.js"
import { viaSpan, type PcbTrack, type PcbVia } from "../copper.js"
import type { Board, CopperPour, Point, PourLayer } from "../model.js"
import type { WorldPad } from "../pcb.js"
import { requiredClearance } from "../rules/classes.js"
import type { Rules } from "../rules/schema.js"
import { counterClockwise, offset, toPath, union, type IntPoint, type Paths } from "./clip.js"
import { shapeOutline } from "./shapes.js"
import { thermalRelief } from "./thermal.js"

/** What a pour's fill is computed from: the board (outline, keepouts, holes), the placed pads, the copper, the rules. */
export interface PourInputs {
  board: Board
  pads: readonly WorldPad[]
  tracks: readonly PcbTrack[]
  vias: readonly PcbVia[]
  rules: Rules
  /** The net class of a net; copper without a net is in the default class. */
  classOf: ClassOf
}

/** A fill already computed, which pours of lower priority on its layer keep clear of. */
export interface EarlierFill {
  net: string
  layer: PourLayer
  paths: Paths
}

/** What a pour meets on its layer. */
export interface LayerCopper {
  /**
   * What the fill keeps out of, as one area: other nets' copper and earlier fills grown by the clearance, keepouts,
   * holes. Every outline is turned counter-clockwise before the union, so a keepout drawn clockwise does not cancel
   * a pad it overlaps under the non-zero rule.
   */
  obstacles: Paths
  /** The pour's own pads grown by the relief gap (relief pours only). */
  cuts: Paths
  /** The relief spokes across those gaps. */
  spokes: Paths
  /** Points of the pour's own net's copper: a piece of fill holding none of them is an island. */
  anchors: IntPoint[]
}

/**
 * How much further than the clearance obstacles are grown, in mm: rounding to 1 µm and a round offset's sides
 * (within 2 µm of the true arc) never bring the fill closer than the clearance.
 */
const MARGIN = 0.003

const padOnLayer = (pad: WorldPad, layer: PourLayer) => pad.layers === "through" || pad.layers === layer

function trackShapes(track: PcbTrack): Shape[] {
  const radius = track.width / 2
  if (track.points.length < 2) return track.points.map((p) => ({ core: [p], radius }))
  return track.points.slice(1).map((p, i) => ({ core: [track.points[i] as Point, p], radius }))
}

/** The gap the pour keeps to copper of another class: the pour's own clearance when larger than the rules'. */
function gapTo(pour: CopperPour, inputs: PourInputs, net: string | undefined): number {
  const required = requiredClearance(inputs.rules, inputs.classOf(pour.net), inputs.classOf(net))
  return Math.max(pour.clearance ?? 0, required)
}

/** The tracks and vias on the pour's layer (copper on a layer the board lacks joins nothing and is left out). */
function layerItems(pour: CopperPour, inputs: PourInputs): { tracks: PcbTrack[]; vias: PcbVia[] } {
  const tracks = inputs.tracks.filter((track) => track.missingLayer === undefined && track.layer === pour.layer)
  const vias = inputs.vias.filter((via) => via.missingLayer === undefined && viaSpan(via).has(pour.layer))
  return { tracks, vias }
}

/** Other nets' pads, tracks and vias on the layer, each grown by the clearance: one simple outline apiece. */
function otherNets(pour: CopperPour, inputs: PourInputs): Paths {
  const grown = (shape: Shape, net: string | undefined) => toPath(shapeOutline(shape, gapTo(pour, inputs, net) + MARGIN))
  const { tracks, vias } = layerItems(pour, inputs)
  const pads = inputs.pads.filter((pad) => padOnLayer(pad, pour.layer) && pad.net !== pour.net)
  return [
    ...pads.flatMap((pad) => {
      const shape = padShape(pad)
      return shape === undefined ? [] : [grown(shape, pad.net)]
    }),
    ...tracks.filter((track) => track.net !== pour.net).flatMap((track) => trackShapes(track).map((shape) => grown(shape, track.net))),
    ...vias.filter((via) => via.net !== pour.net).map((via) => grown({ core: [via.at], radius: via.diameter / 2 }, via.net)),
  ]
}

/** The earlier fills of other nets on the layer grown by the clearance; each comes out of the offset with its holes. */
function earlierFills(pour: CopperPour, inputs: PourInputs, earlier: readonly EarlierFill[]): Paths {
  const fills = earlier.filter((fill) => fill.layer === pour.layer && fill.net !== pour.net)
  return fills.flatMap((fill) => offset(fill.paths, gapTo(pour, inputs, fill.net) + MARGIN, "round"))
}

function boardObstacles(pour: CopperPour, inputs: PourInputs): Paths {
  const edge = inputs.rules.fabrication.boardEdgeClearance
  const keepouts = inputs.board.keepouts.filter((keepout) => keepout.layers === "all" || keepout.layers === pour.layer)
  const holes = (inputs.board.holes ?? []).map((hole) => shapeOutline({ core: [{ x: hole.x, y: hole.y }], radius: hole.diameter / 2 }, edge + MARGIN))
  return [...keepouts.map((keepout) => toPath(keepout.outline)), ...holes.map(toPath)]
}

function ownNet(pour: CopperPour, inputs: PourInputs): Pick<LayerCopper, "cuts" | "spokes" | "anchors"> {
  const pads = inputs.pads.filter((pad) => padOnLayer(pad, pour.layer) && pad.net === pour.net)
  const { tracks, vias } = layerItems(pour, inputs)
  const anchors: Point[] = [
    ...pads.flatMap((pad) => [{ x: pad.x, y: pad.y }, ...(padShape(pad)?.core ?? [])]),
    ...tracks.filter((track) => track.net === pour.net).flatMap((track) => track.points),
    ...vias.filter((via) => via.net === pour.net).map((via) => via.at),
  ]
  const reliefs = pour.thermal === "relief" ? pads.flatMap((pad) => thermalRelief(pad, pour.thermalGap, pour.thermalWidth) ?? []) : []
  return {
    cuts: reliefs.map((relief) => toPath(relief.cut)),
    spokes: reliefs.flatMap((relief) => relief.spokes.map(toPath)),
    anchors: toPath(anchors),
  }
}

/** Everything the pour meets on its layer, from the inputs and the fills of the pours that come before it. */
export function layerCopper(pour: CopperPour, inputs: PourInputs, earlier: readonly EarlierFill[]): LayerCopper {
  const outlines = [...otherNets(pour, inputs), ...boardObstacles(pour, inputs)].map(counterClockwise)
  return { obstacles: union([...outlines, ...earlierFills(pour, inputs, earlier)]), ...ownNet(pour, inputs) }
}
