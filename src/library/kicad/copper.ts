// The copper of a KiCad board: tracks (straight segments, and arcs as short straight pieces, since the layout file
// holds point lists), vias, filled zones as pours (the outline only: copperflow fills a pour itself) and keepout zones.
import type { Point } from "../../engine/model.js"
import { arcPolyline, pointOf, ptsPoints } from "./geometry.js"
import { netName } from "./footprints.js"
import { child, children, flag, numberAt, textAt, texts, type SList } from "./sexpr.js"
import type { Tally } from "./tally.js"

export type Side = "top" | "bottom"

export interface KicadTrack {
  net?: string
  layer: Side
  width: number
  points: Point[]
}

export interface KicadVia {
  net?: string
  at: Point
  diameter: number
  drill: number
}

export interface KicadPour {
  net: string
  layer: Side
  outline: Point[]
  props: { priority?: number; clearance?: number; minWidth?: number; thermalGap?: number; thermalWidth?: number }
}

export interface ReadCopper {
  tracks: KicadTrack[]
  vias: KicadVia[]
  pours: KicadPour[]
  keepouts: Point[][]
  /** What the file held, to answer against. */
  held: { segments: number; arcs: number; arcPieces: number; vias: number; zones: number }
}

const SIDES: Record<string, Side> = { "F.Cu": "top", "B.Cu": "bottom" }

function readTrack(item: SList, arc: boolean, nets: ReadonlyMap<number, string>, tally: Tally, found: ReadCopper): void {
  const layer = SIDES[textAt(child(item, "layer"), 1) ?? ""]
  if (!layer) {
    tally.add("innerTracks")
    return
  }
  const [start, end, mid] = [pointOf(item, "start"), pointOf(item, "end"), pointOf(item, "mid")]
  const width = numberAt(child(item, "width"), 1) ?? 0
  if (!start || !end || width <= 0 || (arc && !mid)) {
    tally.skip(arc ? "arc" : "segment")
    return
  }
  const points = arc && mid ? arcPolyline(start, mid, end) : [start, end]
  if (arc) found.held.arcPieces += points.length - 1
  if (flag(item, "locked")) tally.add("locked")
  const net = netName(item, nets)
  found.tracks.push({ ...(net ? { net } : {}), layer, width, points })
}

function readVia(item: SList, nets: ReadonlyMap<number, string>, tally: Tally, found: ReadCopper): void {
  const at = pointOf(item, "at")
  const [diameter, drill] = [numberAt(child(item, "size"), 1) ?? 0, numberAt(child(item, "drill"), 1) ?? 0]
  if (!at || diameter <= drill || drill <= 0) {
    tally.skip("via")
    return
  }
  const layers = texts(child(item, "layers"))
  if (!(layers.includes("F.Cu") && layers.includes("B.Cu"))) {
    tally.add("innerVias")
    return
  }
  if (flag(item, "locked")) tally.add("locked")
  const net = netName(item, nets)
  found.vias.push({ ...(net ? { net } : {}), at, diameter, drill })
}

/** Whether every rule of a keepout zone forbids: then copperflow's keepout (nothing on any layer) is its like. */
function keepsAllOut(keepout: SList): boolean {
  return keepout.list.slice(1).every((rule) => "list" in rule && textAt(rule, 1) === "not_allowed")
}

function readZone(zone: SList, nets: ReadonlyMap<number, string>, tally: Tally, found: ReadCopper): void {
  found.held.zones++
  const outline = ptsPoints(child(child(zone, "polygon") ?? zone, "pts"))
  if (outline.length < 3) {
    tally.skip("zone")
    return
  }
  const attr = child(zone, "attr")
  if (attr && child(attr, "teardrop")) {
    tally.add("teardrops")
    return
  }
  const keepout = child(zone, "keepout")
  if (keepout) {
    if (!keepsAllOut(keepout)) tally.add("keepouts")
    found.keepouts.push(outline)
    return
  }
  const layers = [textAt(child(zone, "layer"), 1), ...texts(child(zone, "layers"))].flatMap((name) => (name && SIDES[name] ? [SIDES[name] as Side] : []))
  if (layers.length === 0) {
    tally.add("otherZones")
    return
  }
  const net = netName(zone, nets) ?? (textAt(child(zone, "net_name"), 1) || undefined)
  if (!net) {
    tally.add("emptyZones")
    return
  }
  const fill = child(zone, "fill")
  const number = (list: SList | undefined, name: string) => numberAt(list && child(list, name), 1)
  const props = {
    ...(numberAt(child(zone, "priority"), 1) !== undefined ? { priority: numberAt(child(zone, "priority"), 1) } : {}),
    ...(number(child(zone, "connect_pads"), "clearance") ? { clearance: number(child(zone, "connect_pads"), "clearance") } : {}),
    ...(number(zone, "min_thickness") ? { minWidth: number(zone, "min_thickness") } : {}),
    ...(number(fill, "thermal_gap") ? { thermalGap: number(fill, "thermal_gap") } : {}),
    ...(number(fill, "thermal_bridge_width") ? { thermalWidth: number(fill, "thermal_bridge_width") } : {}),
  } as KicadPour["props"]
  for (const layer of new Set(layers)) found.pours.push({ net, layer, outline, props })
}

/** Every track, via and zone of the board, and the zones its footprints hold. */
export function readCopper(top: SList, footprintZones: readonly SList[], nets: ReadonlyMap<number, string>, tally: Tally): ReadCopper {
  const found: ReadCopper = { tracks: [], vias: [], pours: [], keepouts: [], held: { segments: 0, arcs: 0, arcPieces: 0, vias: 0, zones: 0 } }
  for (const item of children(top, "segment")) {
    found.held.segments++
    readTrack(item, false, nets, tally, found)
  }
  for (const item of children(top, "arc")) {
    found.held.arcs++
    readTrack(item, true, nets, tally, found)
  }
  for (const item of children(top, "via")) {
    found.held.vias++
    readVia(item, nets, tally, found)
  }
  for (const zone of [...children(top, "zone"), ...footprintZones]) readZone(zone, nets, tally, found)
  return found
}
