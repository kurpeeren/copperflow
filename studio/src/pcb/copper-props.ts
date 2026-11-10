// What Properties shows for one selected track or via (or one selected segment of a track), and the edit each of its
// editable rows (a track's width and layer, the lock of either) sends. Pure; plain TypeScript with .js imports, so the tests can run it.
import type { LayoutEdit } from "../../../src/core/layout-records.js"
import { trackLength } from "../../../src/engine/copper.js"
import type { PcbTrack, PcbVia } from "../../../src/engine/pcb.js"
import { hasSegment } from "../../../src/core/track-split.js"
import type { TrackSegment } from "../selection.js"

/** What these rows read of the built design. */
export interface CopperDesign {
  circuit: { nets: readonly { id: string; names: readonly string[] }[] }
  pcb: { tracks: readonly PcbTrack[]; vias: readonly PcbVia[] }
}

/** A row that can be changed: the track's width or layer, or the lock. */
export type CopperField = "width" | "layer" | "lock"

export interface CopperRow {
  label: string
  value: string
  field?: CopperField
}

export interface CopperProperties {
  kind: "track" | "via"
  title: "Track" | "Via"
  locked: boolean
  rows: CopperRow[]
}

const LAYER_NAMES: Record<PcbTrack["layer"], string> = { top: "Top Layer", bottom: "Bottom Layer", inner1: "Inner Layer 1", inner2: "Inner Layer 2" }
const MAKERS: Record<PcbTrack["by"], string> = { human: "You", agent: "The agent", router: "The router" }

const mm = (value: number): string => `${Math.round(value * 1000) / 1000} mm`

export { trackLength }

function netName(design: CopperDesign, net: string | undefined): string {
  if (net === undefined) return "No net"
  return design.circuit.nets.find((one) => one.id === net)?.names[0] ?? net
}

function trackRows(design: CopperDesign, track: PcbTrack): CopperRow[] {
  return [
    { label: "Net", value: netName(design, track.net) },
    { label: "Layer", value: track.layer, field: "layer" },
    { label: "Width", value: String(track.width), field: "width" },
    { label: "Length", value: mm(trackLength(track.points)) },
    { label: "Drawn by", value: MAKERS[track.by] },
    { label: "Locked", value: String(track.locked), field: "lock" },
  ]
}

function viaRows(design: CopperDesign, via: PcbVia): CopperRow[] {
  const [first = "top", last = "bottom"] = [via.layers[0], via.layers.at(-1)]
  return [
    { label: "Net", value: netName(design, via.net) },
    { label: "Layers", value: `${LAYER_NAMES[first]} to ${LAYER_NAMES[last]}` },
    { label: "Drill", value: mm(via.drill) },
    { label: "Diameter", value: mm(via.diameter) },
    { label: "Drawn by", value: MAKERS[via.by] },
    { label: "Locked", value: String(via.locked), field: "lock" },
  ]
}

/** The rows of the track or via `id`, or undefined when the design has no such copper. */
export function copperProperties(design: CopperDesign, id: string): CopperProperties | undefined {
  const track = design.pcb.tracks.find((one) => one.id === id)
  if (track) return { kind: "track", title: "Track", locked: track.locked, rows: trackRows(design, track) }
  const via = design.pcb.vias.find((one) => one.id === id)
  return via && { kind: "via", title: "Via", locked: via.locked, rows: viaRows(design, via) }
}

/** A selected segment's rows: its track's net, which segment of which track, its length and its two ends. */
export interface SegmentProperties {
  kind: "segment"
  title: "Segment"
  locked: boolean
  rows: CopperRow[]
}

const at = (p: { x: number; y: number }): string => `(${Math.round(p.x * 1000) / 1000}, ${Math.round(p.y * 1000) / 1000}) mm`

/** The rows of `segment`, or undefined when the design has no such track or the track no such segment. */
export function segmentProperties(design: CopperDesign, segment: TrackSegment): SegmentProperties | undefined {
  const track = design.pcb.tracks.find((one) => one.id === segment.id)
  if (!track || !hasSegment(track.points, segment.index)) return undefined
  const [start, end] = [track.points[segment.index], track.points[segment.index + 1]] as [PcbTrack["points"][number], PcbTrack["points"][number]]
  return {
    kind: "segment",
    title: "Segment",
    locked: track.locked,
    rows: [
      { label: "Net", value: netName(design, track.net) },
      { label: "Track", value: track.id },
      { label: "Length", value: mm(trackLength([start, end])) },
      { label: "Start", value: at(start) },
      { label: "End", value: at(end) },
    ],
  }
}

/** A track (it has points) or a via (it has none), as the field edits read it. */
type Item = Pick<PcbTrack, "id" | "locked"> & Partial<Pick<PcbTrack, "width" | "layer" | "points">>

/** One field's change: its edit and the history's summary. */
export type FieldChange = { edit: LayoutEdit; summary: string }

function lockChange(item: Item, raw: string): FieldChange | undefined {
  const locked = raw === "true"
  if (locked === item.locked) return undefined
  const kind = item.points ? "setTrack" : "setVia"
  return { edit: { kind, id: item.id, locked }, summary: `${locked ? "Lock" : "Unlock"} ${item.id}` }
}

/**
 * The edit a row's new value sends, nothing when the value is the same, or why it cannot: a width must be a number
 * of mm above 0, a layer top or bottom, and a locked track changes only its lock.
 */
export function copperFieldEdit(item: Item, field: CopperField, raw: string): FieldChange | { message: string } | undefined {
  if (field === "lock") return lockChange(item, raw)
  if (item.locked) return { message: `${item.id} is locked` }
  if (field === "width") {
    const width = Number(raw.trim())
    if (raw.trim() === "" || !Number.isFinite(width) || width <= 0) return { message: "The width must be a number of mm above 0" }
    return width === item.width ? undefined : { edit: { kind: "setTrack", id: item.id, width }, summary: `Set the width of ${item.id} to ${width} mm` }
  }
  if (raw !== "top" && raw !== "bottom") return { message: "The layer must be top or bottom" }
  return raw === item.layer ? undefined : { edit: { kind: "setTrack", id: item.id, layer: raw }, summary: `Move ${item.id} to the ${raw} layer` }
}
