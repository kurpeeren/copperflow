// Copper pours for current. A pour on a net that carries current (the same current track-current.ts sizes tracks for)
// joins that net's pads, tracks and vias on its layer through its copper. Its narrowest neck between them must be as
// wide as IPC-2221 asks of a track. The neck is measured on a grid that never reads it wider than the copper (neck.ts),
// from half that width out from each pad, track and via (the current spreads as it leaves them, and a pad near the
// pour's edge is not a neck); where two of those areas meet it is read. Copper too thin for the grid to hold at all is
// found from the true copper's pieces and warned too. A pour whose minWidth is at least that width is not measured:
// its fill already drops copper narrower than minWidth. A relief pour joins each pad through spokes, and their widths
// together must be that wide too. Each pour short of either is one `pour-current` warning. Pure.
import { viaSpan } from "../copper.js"
import type { Circuit, CopperPour, Point } from "../model.js"
import type { PcbLayout, PourFill, WorldPad } from "../pcb.js"
import { intersection, regionHolds, regions, toPath, toPoints, union, type Paths, type Region } from "../pour/clip.js"
import { pourJoins } from "../pour/joins.js"
import { shapeOutline } from "../pour/shapes.js"
import { thermalRelief } from "../pour/thermal.js"
import type { Rules } from "../rules/schema.js"
import { padShape, pointInPolygon, type Shape } from "./geometry.js"
import { narrowestNecks, unread, UNDER_READ, type Neck, type Terminal } from "./neck.js"
import { mm, netCurrents, ONE_OUNCE, TEMPERATURE_RISE, widthForCurrent, type CopperSide, type NetCurrent } from "./track-current.js"
import { violation, type Violation } from "./violation.js"

/**
 * The neck is first measured on cells a twentieth of the width the current needs, on no more than 60 000 cells; when
 * that cannot show the pour wide enough, again on cells a hundredth of the width, on no more than 400 000.
 */
const PASSES = [
  { perWidth: 20, cells: 60_000 },
  { perWidth: 100, cells: 400_000 },
] as const
/** How far round the pour's box the copper of the things it joins is kept, in mm. */
const AROUND = 1
/** How far past an item's copper its terminal's core reaches, in cells: the grid keeps every copper cell half a diagonal clear of the copper's edge, so a core this much larger still meets the copper beside a small pad. */
const TERMINAL_REACH = 1.5
/** Copper narrower than this many cells may leave no whole cell on the grid. */
const UNREAD_CELLS = 3
/** How many joined things a message names before "and N more". */
const NAMED = 4

/** A piece of the pour's own net's copper on its layer that the fill touches. */
interface Item {
  id: string
  shapes: Shape[]
  /** For a pad on a relief pour: the pad, and how many of its spokes reach the fill. */
  relief?: { pad: WorldPad; spokes: number }
}

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** A neck as measured: `unread` when the copper there is too thin for the grid to hold at all. */
type Measured = Neck & { cell: number; unread?: true }

interface Shortfall {
  neck?: Measured
  spokes?: { pads: string[]; fewest: number; width: number; at: Point }
}

const padOn = (pad: WorldPad, layer: string) => pad.layers === "through" || pad.layers === layer

/** Inside a piece of the fill: inside its outline and in none of its holes. */
const inFill = (fill: PourFill, p: Point): boolean =>
  fill.polygons.some((polygon) => pointInPolygon(p, polygon.outer) && !polygon.holes.some((hole) => pointInPolygon(p, hole)))

const trackShapes = (points: readonly Point[], width: number): Shape[] =>
  points.length < 2 ? points.map((p) => ({ core: [p], radius: width / 2 })) : points.slice(1).map((p, i) => ({ core: [points[i] as Point, p], radius: width / 2 }))

/** The pour's net's pads, tracks and vias on its layer that its fill touches; a relief pad with how many of its spokes reach the fill. */
function itemsOf(fill: PourFill, pour: CopperPour | undefined, layout: PcbLayout): Item[] {
  const allPads = layout.parts.flatMap((part) => part.pads).filter((pad) => pad.unplaced === undefined)
  const touched = new Set(pourJoins([fill], allPads, layout.tracks, layout.vias).flat())
  const pads = allPads.flatMap((pad): Item[] => {
    const shape = touched.has(pad.id) && padOn(pad, fill.layer) ? padShape(pad) : undefined
    if (shape === undefined) return []
    if (pour?.thermal !== "relief") return [{ id: pad.id, shapes: [shape] }]
    const relief = thermalRelief(pad, pour.thermalGap, pour.thermalWidth)
    const spokes = relief === undefined ? 0 : relief.tips.filter((tip) => inFill(fill, tip)).length
    return [{ id: pad.id, shapes: [shape], relief: { pad, spokes } }]
  })
  const tracks = layout.tracks.filter((track) => touched.has(track.id) && track.layer === fill.layer)
  const vias = layout.vias.filter((via) => touched.has(via.id) && viaSpan(via).has(fill.layer))
  return [
    ...pads,
    ...tracks.map((track) => ({ id: track.id, shapes: trackShapes(track.points, track.width) })),
    ...vias.map((via) => ({ id: via.id, shapes: [{ core: [via.at], radius: via.diameter / 2 }] })),
  ]
}

function boxOf(fill: PourFill): Box {
  const points = fill.polygons.flatMap((polygon) => polygon.outer)
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return { minX: Math.min(...xs) - AROUND, minY: Math.min(...ys) - AROUND, maxX: Math.max(...xs) + AROUND, maxY: Math.max(...ys) + AROUND }
}

/** The fill and the copper of the things it joins as one area, cut to the box, piece by piece. */
function copperPieces(fill: PourFill, items: readonly Item[], box: Box): Region[] {
  const paths: Paths = [
    ...fill.polygons.flatMap((polygon) => [polygon.outer, ...polygon.holes]).map(toPath),
    ...items.flatMap((item) => item.shapes.map((shape) => toPath(shapeOutline(shape)))),
  ]
  const { minX, minY, maxX, maxY } = box
  const cut = toPath([
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ])
  return regions(intersection(union(paths), [cut]))
}

/** For each piece of copper, the items whose copper is in it: the terminals the copper truly joins. */
function together(pieces: readonly Region[], items: readonly Item[]): string[][] {
  const pointsOf = (item: Item) => toPath(item.shapes.flatMap((shape) => shape.core))
  return pieces.map((piece) => items.filter((item) => pointsOf(item).some((p) => regionHolds(piece, p))).map((item) => item.id))
}

/** Where an item is, for a neck the grid cannot place: its first point. */
const placeOf = (items: readonly Item[], id: string | undefined): Point | undefined => items.find((item) => item.id === id)?.shapes[0]?.core[0]

/**
 * Each item as a terminal: its core is its copper and, for a relief pad, its spokes across the gap, a little larger
 * (TERMINAL_REACH); its spread reaches half the needed width further, where the copper is not measured.
 */
function terminals(items: readonly Item[], pour: CopperPour | undefined, cell: number, need: number): Terminal[] {
  return items.map((item) => {
    const core = TERMINAL_REACH * cell + (item.relief !== undefined && pour !== undefined ? pour.thermalGap + pour.thermalWidth : 0)
    return { id: item.id, core: item.shapes.map((shape) => shapeOutline(shape, core)), spread: item.shapes.map((shape) => shapeOutline(shape, core + need / 2)) }
  })
}

/** The narrowest neck narrower than `need`: measured coarse, then fine when the coarse cells cannot show the pour wide enough. */
function narrowNeck(fill: PourFill, pour: CopperPour | undefined, items: readonly Item[], need: number): Measured | undefined {
  const box = boxOf(fill)
  const area = (box.maxX - box.minX) * (box.maxY - box.minY)
  const pieces = copperPieces(fill, items, box)
  const rings = pieces.flatMap((piece) => [piece.outer, ...piece.holes].map(toPoints))
  const truly = together(pieces, items)
  let found: Measured | undefined
  let previous = 0
  for (const pass of PASSES) {
    const cell = Math.max(need / pass.perWidth, Math.sqrt(area / pass.cells))
    if (cell >= previous && previous > 0) break
    previous = cell
    const necks = narrowestNecks(rings, terminals(items, pour, cell, need), cell)
    const lost = unread(necks, truly)[0]
    const narrow = necks.filter((neck) => neck.width < need).sort((a, b) => a.width - b.width)[0]
    if (lost === undefined && narrow === undefined) return undefined
    const at = placeOf(items, lost?.find((id) => !necks.some((neck) => neck.joined.includes(id))) ?? lost?.[1])
    found = lost === undefined ? { ...(narrow as Neck), cell } : { width: 0, ...(at === undefined ? {} : { at }), joined: lost, cell, unread: true }
  }
  return found
}

/** What the pour lacks for `need` mm: its narrowest neck when narrower, and its pads joined through too few spokes. */
function shortfall(fill: PourFill, pour: CopperPour | undefined, layout: PcbLayout, need: number): Shortfall {
  const items = itemsOf(fill, pour, layout)
  if (items.length < 2) return {}
  const neck = pour !== undefined && pour.minWidth >= need ? undefined : narrowNeck(fill, pour, items, need)
  const short = items.flatMap((item) => (item.relief !== undefined && pour !== undefined && item.relief.spokes > 0 && item.relief.spokes * pour.thermalWidth < need ? [item.relief] : []))
  const first = short[0]
  const spokes =
    first === undefined || pour === undefined
      ? undefined
      : { pads: short.map((one) => one.pad.id), fewest: Math.min(...short.map((one) => one.spokes)), width: pour.thermalWidth, at: { x: first.pad.x, y: first.pad.y } }
  return { ...(neck === undefined ? {} : { neck }), ...(spokes === undefined ? {} : { spokes }) }
}

function named(ids: readonly string[]): string {
  const shown = ids.slice(0, NAMED)
  const rest = ids.length - shown.length
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`
  return shown.length === 1 ? (shown[0] as string) : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1] as string}`
}

/** How the neck reads: between its lower bound and that plus what the grid can lose; under three cells when the grid cannot hold it. */
function neckText(neck: Measured): string {
  const where = neck.at === undefined ? "" : ` near (${mm(neck.at.x)}, ${mm(neck.at.y)})`
  const width = neck.unread === true ? `under ${mm(UNREAD_CELLS * neck.cell)} mm, too thin for the grid to place,` : `between ${mm(neck.width)} and ${mm(neck.width + UNDER_READ * neck.cell)} mm${where}`
  return `narrows to ${width} on its way between ${named(neck.joined)}`
}

function message(name: string, current: NetCurrent, fill: PourFill, side: CopperSide, thickness: number, need: number, found: Shortfall): string {
  const { neck, spokes } = found
  const lacks = [
    ...(neck === undefined ? [] : [neckText(neck)]),
    ...(spokes === undefined ? [] : [`joins ${named(spokes.pads)} through as few as ${spokes.fewest} thermal spokes ${mm(spokes.width)} mm wide (${mm(spokes.fewest * spokes.width)} mm in all)`]),
  ]
  const read =
    neck === undefined
      ? ""
      : ` The neck is read from ${mm(need / 2)} mm out from each pad, track and via, on a ${mm(neck.cell)} mm grid, which never reads it wider than the copper.`
  const wider = spokes === undefined ? 0 : Math.ceil((need / Math.max(1, spokes.fewest)) * 100) / 100
  const fixes = [
    ...(neck === undefined ? [] : ["widen the pour where it narrows (move what pinches it, or widen its outline)"]),
    ...(spokes === undefined ? [] : [`give it thermal "solid", or a thermalWidth of ${wider.toFixed(2)} mm`]),
  ]
  const layer = side === "outer" ? "an outer" : "an inner"
  return (
    `${name} carries ${mm(current.amps)} A (${current.from}): for a ${TEMPERATURE_RISE} °C rise in ${mm(thickness)} mm copper it needs ${need.toFixed(2)} mm of copper ` +
    `on ${layer} layer (IPC-2221), but ${fill.id} ${lacks.join(", and ")}.${read} To carry it, ${fixes.join("; and ")}`
  )
}

/** One `pour-current` warning per pour whose copper is too narrow, at a neck or in its spokes, for the current its net carries. */
export function pourCurrentChecks(circuit: Circuit, layout: PcbLayout, rules: Rules): Violation[] {
  const filled = layout.pours.filter((fill) => fill.polygons.length > 0)
  if (filled.length === 0) return []
  const currents = netCurrents(circuit, rules)
  if (currents.size === 0) return []
  const thickness = rules.fabrication.copperThickness ?? ONE_OUNCE
  return filled.flatMap((fill) => {
    const current = currents.get(fill.net)
    if (current === undefined) return []
    const side: CopperSide = fill.layer === "top" || fill.layer === "bottom" ? "outer" : "inner"
    const need = widthForCurrent(current.amps, thickness, side)
    const pour = layout.board?.pours?.find((one) => one.id === fill.id)
    const found = shortfall(fill, pour, layout, need)
    if (found.neck === undefined && found.spokes === undefined) return []
    const name = circuit.nets.find((net) => net.id === fill.net)?.names[0] ?? fill.net.replace(/^net\./, "")
    return [violation("pour-current", "warning", message(name, current, fill, side, thickness, need, found), [fill.id], "pcb", found.neck?.at ?? found.spokes?.at)]
  })
}
