import type { ClassOf } from "../checks/copper-pieces.js"
import { padShape, type Shape } from "../checks/geometry.js"
import { viaSpan, type PcbTrack, type PcbVia } from "../copper.js"
import type { Board, CopperPour, Point, PourLayer } from "../model.js"
import type { WorldPad } from "../pcb.js"
import { requiredClearance } from "../rules/classes.js"
import type { Rules } from "../rules/schema.js"
import { counterClockwise, offset, toPath, union, type IntPoint, type Path, type Paths } from "./clip.js"
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
  /** The relief round each of the pour's own pads (relief pours only). */
  reliefs: PadRelief[]
  /** Outlines of the pour's own net's copper on the layer: a piece of fill meeting none of them is an island. */
  anchors: Paths
}

/** A pad's relief: the pad grown by the gap, and its spokes, each with the point the fill must hold to keep it. */
export interface PadRelief {
  cut: Path
  spokes: { path: Path; tip: IntPoint }[]
}

/**
 * How much further than the clearance obstacles are grown, in mm: rounding to 1 µm and a round offset's sides
 * (within 2 µm of the true arc) never bring the fill closer than the clearance.
 */
const MARGIN = 0.003
/**
 * How much further than the clearance an earlier fill is grown, in mm: 10 µm. Both outlines are arcs drawn as chords
 * (each up to 2 µm inside the true arc) and rounded to 1 µm, and a fill's sliver between two arcs can sit nearer
 * still; 10 µm dominates all of it, so two fills always end at least the clearance apart.
 */
const FILL_MARGIN = 0.01
/** How far the pour's own copper is grown to find the pieces it touches, in mm: 1 µm, so meeting at an edge counts. */
const TOUCH = 0.001

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

/**
 * The drawings on copper on the pour's layer, grown by the clearance: a drawing belongs to no net, so every pour keeps
 * clear of it. Its areas are grown whole (a hole in it shrinks, and a pour may still fill a large one); its lines one
 * segment at a time.
 */
function drawings(pour: CopperPour, inputs: PourInputs): Paths {
  const here = (inputs.board.graphics ?? []).filter((graphic) => graphic.layer === pour.layer)
  if (here.length === 0) return []
  const gap = gapTo(pour, inputs, undefined) + MARGIN
  return here.flatMap((graphic) => {
    const rings = graphic.areas.flatMap((area) => [counterClockwise(toPath(area.outer)), ...area.holes.map((hole) => [...counterClockwise(toPath(hole))].reverse())])
    const areas = rings.length === 0 ? [] : offset(rings, gap, "round")
    const lines = graphic.lines.flatMap((line) =>
      (line.points.length === 1 ? [[line.points[0] as Point]] : line.points.slice(1).map((p, i) => [line.points[i] as Point, p])).map((core) => counterClockwise(toPath(shapeOutline({ core, radius: line.width / 2 }, gap)))),
    )
    return [...areas, ...lines]
  })
}

/** The earlier fills of other nets on the layer grown by the clearance; each comes out of the offset with its holes. */
function earlierFills(pour: CopperPour, inputs: PourInputs, earlier: readonly EarlierFill[]): Paths {
  const fills = earlier.filter((fill) => fill.layer === pour.layer && fill.net !== pour.net)
  return fills.flatMap((fill) => offset(fill.paths, gapTo(pour, inputs, fill.net) + FILL_MARGIN, "round"))
}

function boardObstacles(pour: CopperPour, inputs: PourInputs): Paths {
  const edge = inputs.rules.fabrication.boardEdgeClearance
  const keepouts = inputs.board.keepouts.filter((keepout) => keepout.layers === "all" || keepout.layers === pour.layer)
  const holes = (inputs.board.holes ?? []).map((hole) => shapeOutline({ core: [{ x: hole.x, y: hole.y }], radius: hole.diameter / 2 }, edge + MARGIN))
  return [...keepouts.map((keepout) => toPath(keepout.outline)), ...holes.map(toPath)]
}

function ownNet(pour: CopperPour, inputs: PourInputs): Pick<LayerCopper, "reliefs" | "anchors"> {
  const pads = inputs.pads.filter((pad) => padOnLayer(pad, pour.layer) && pad.net === pour.net)
  const { tracks, vias } = layerItems(pour, inputs)
  const shapes: Shape[] = [
    ...pads.flatMap((pad) => padShape(pad) ?? []),
    ...tracks.filter((track) => track.net === pour.net).flatMap(trackShapes),
    ...vias.filter((via) => via.net === pour.net).map((via) => ({ core: [via.at], radius: via.diameter / 2 })),
  ]
  const reliefs = pour.thermal === "relief" ? pads.flatMap((pad) => thermalRelief(pad, pour.thermalGap, pour.thermalWidth) ?? []) : []
  return {
    reliefs: reliefs.map((relief) => ({
      cut: toPath(relief.cut),
      spokes: relief.spokes.map((spoke, i) => ({ path: toPath(spoke), tip: toPath([relief.tips[i] as Point])[0] as IntPoint })),
    })),
    anchors: shapes.map((shape) => toPath(shapeOutline(shape, TOUCH))).filter((path) => path.length >= 3),
  }
}

/** Everything the pour meets on its layer, from the inputs and the fills of the pours that come before it. */
export function layerCopper(pour: CopperPour, inputs: PourInputs, earlier: readonly EarlierFill[]): LayerCopper {
  const outlines = [...otherNets(pour, inputs), ...boardObstacles(pour, inputs)].map(counterClockwise)
  return { obstacles: union([...outlines, ...earlierFills(pour, inputs, earlier), ...drawings(pour, inputs)]), ...ownNet(pour, inputs) }
}
