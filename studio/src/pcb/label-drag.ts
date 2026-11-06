// Dragging net labels and ground or power symbols in the schematic: which label is under the
// pointer, and the edit a drop writes. A label stays attached to its pin; the drop point becomes the
// last corner of a wire from that pin, written as `schematicRouteHints` on the trace to the net.
// Only types come from the engine, except its symbols: its other runtime modules reach Node-only code.
import type { Edit, TraceInfo } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import type { Connection, Pin, Side } from "../../../src/engine/model.js"
import type { NetLabel } from "../../../src/engine/schematic.js"
import { groundSymbol, powerSymbol } from "../../../src/engine/symbols/index.js"
import { boundsOf } from "../../../src/engine/symbols/types.js"
import { rightAngles, type Box, type Point } from "./geometry.js"
import { labelTag } from "./label-tag.js"
import type { SourceCircuit } from "./positions.js"
import { addressable, pinOfSelector, pinSelector } from "./wire-tool.js"

export type LabelDrag = Edit[] | { blocked: string }

/** Where a label is drawn while it is dragged or waits for its build, and the wire to it. */
export interface LabelPreview {
  at: Point
  side: Side
  /** The wire from the pin to `at`, drawn dashed. */
  wire: Point[]
  /** The id of the label's old hand-drawn wire, which the new one replaces. */
  hideWire?: string
}

/** A ground or power symbol is small; pointing near its drawing counts. */
const LABEL_REACH = 0.1
const NET_SELECTOR = /^net\.([\w-]+)$/
const round = (value: number): number => Math.round(value * 1000) / 1000 || 0

/** What a label hangs on: its pin, the pin's end on the sheet, and the connection of a hand-drawn label. */
interface Anchor {
  label: NetLabel
  pin: Pin
  end: Point
  connection?: Connection
}

/** The area a label answers to: the drawn tag of a net label, the drawn bounds plus a little reach for a symbol. */
export function labelHitBox(label: NetLabel): Box {
  if (label.style === "label") return labelTag(label).box
  const bounds = boundsOf(label.style === "ground" ? groundSymbol() : powerSymbol(label.text), [])
  return {
    minX: label.at.x + bounds.minX - LABEL_REACH,
    minY: label.at.y + bounds.minY - LABEL_REACH,
    maxX: label.at.x + bounds.maxX + LABEL_REACH,
    maxY: label.at.y + bounds.maxY + LABEL_REACH,
  }
}

const inside = (box: Box, p: Point): boolean => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY
const area = (box: Box): number => (box.maxX - box.minX) * (box.maxY - box.minY)

/** The label under `p`: the smallest of those whose area holds it. */
export function labelAt(design: Design, p: Point): NetLabel | undefined {
  return design.schematic.labels
    .map((label) => ({ label, box: labelHitBox(label) }))
    .filter(({ box }) => inside(box, p))
    .sort((a, b) => area(a.box) - area(b.box))[0]?.label
}

function pinEnd(design: Design, pin: string): Point | undefined {
  return design.schematic.symbols.find((symbol) => symbol.pinEnds[pin])?.pinEnds[pin]
}

/** The pin of `label`: that of its hand-drawn connection, else the one in its id `label:<net id>:<pin id>`. */
function anchorOf(design: Design, labelId: string): Anchor | undefined {
  const label = design.schematic.labels.find((candidate) => candidate.id === labelId)
  if (!label) return undefined
  const connection = design.circuit.connections.find((candidate) => `label:${candidate.id}` === label.id)
  const prefix = `label:${label.net}:`
  const pinId = connection ? [connection.from, connection.to].find((end) => !end.startsWith("net.")) : label.id.startsWith(prefix) ? label.id.slice(prefix.length) : undefined
  const pin = design.circuit.components.flatMap((component) => component.pins).find((candidate) => candidate.id === pinId)
  const end = pin && pinEnd(design, pin.id)
  return pin && end ? { label, pin, end, ...(connection ? { connection } : {}) } : undefined
}

/** The corners a hand-drawn label's wire has now, running from its pin. */
function cornersNow(anchor: Anchor): Point[] {
  const corners = anchor.connection?.corners ?? []
  return anchor.connection?.from === anchor.pin.id ? corners : [...corners].reverse()
}

/** The corners from the pin to `drop`: a hand-drawn wire keeps all but its last, then runs at right angles to the drop; dropped on the pin it loses its corners. */
function cornersTo(anchor: Anchor, drop: Point): Point[] {
  if (anchor.connection && drop.x === anchor.end.x && drop.y === anchor.end.y) return []
  const kept = anchor.connection ? cornersNow(anchor).slice(0, -1) : []
  const last = kept[kept.length - 1] ?? anchor.end
  return [...kept, ...rightAngles([last, drop]).slice(1)]
}

const sameCorners = (a: readonly Point[], b: readonly Point[]): boolean =>
  a.length === b.length && a.every((p, i) => p.x === b[i]?.x && p.y === b[i]?.y)

const tidy = (p: Point): Point => ({ x: round(p.x), y: round(p.y) })

function sideOf(from: Point | undefined, to: Point): Side {
  if (!from) return "right"
  if (to.x !== from.x) return to.x > from.x ? "right" : "left"
  return to.y < from.y ? "bottom" : "top"
}

/** The label and its wire as they would be drawn with the label dropped at `drop`; undefined when the label has no pin. */
export function labelPreview(design: Design, labelId: string, drop: Point): LabelPreview | undefined {
  const anchor = anchorOf(design, labelId)
  if (!anchor) return undefined
  const at = tidy(drop)
  const wire = [anchor.end, ...cornersTo(anchor, at)]
  return { at, side: sideOf(wire[wire.length - 2], at), wire, ...(anchor.connection ? { hideWire: `wire:${anchor.connection.id}` } : {}) }
}

/** The names the label's net answers to. */
function netNames(design: Design, label: NetLabel): string[] {
  return design.circuit.nets.find((net) => net.id === label.net)?.names ?? [label.net.replace(/^net\./, "")]
}

/** The source trace that joins the pin to the label's net, in either direction. A repeated pair (`#2`) takes the matching one. */
function traceOf(design: Design, source: SourceCircuit, anchor: Anchor): TraceInfo | undefined {
  const names = netNames(design, anchor.label)
  const toNet = (selector: string | undefined) => names.includes(NET_SELECTOR.exec(selector?.trim() ?? "")?.[1] ?? "")
  const onPin = (selector: string | undefined) => selector !== undefined && pinOfSelector(design, selector)?.id === anchor.pin.id
  const matches = source.model.traces.filter((t) => (onPin(t.from) && toNet(t.to)) || (onPin(t.to) && toNet(t.from)))
  const repeat = Number(/#(\d+)$/.exec(anchor.connection?.id ?? "")?.[1] ?? 1)
  return matches[repeat - 1] ?? matches[0]
}

/** Why the trace cannot be changed, or undefined when it can. */
function traceBlocker(trace: TraceInfo): string | undefined {
  if (!trace.editable) return `This wire is read-only (${trace.readonlyReason}); change it in the code`
  if (trace.props["schematicRouteHints"] && !trace.schematicRouteHints) return "The corners of this wire are an expression; change them in the code"
  return undefined
}

type Target = { anchor: Anchor; trace?: TraceInfo } | { blocked: string }

const NO_LOCKS: ReadonlySet<string> = new Set()

/** The locked part among the label's pin and the ends of its trace, as `core/edit` would refuse it. */
function lockedPart(design: Design, anchor: Anchor, trace: TraceInfo | undefined, locked: ReadonlySet<string>): string | undefined {
  const ends = [trace?.from, trace?.to].flatMap((end) => (end === undefined ? [] : [pinOfSelector(design, end)?.component ?? ""]))
  return [anchor.pin.component, ...ends].find((name) => locked.has(name))
}

function targetOf(design: Design, source: SourceCircuit, labelId: string, locked: ReadonlySet<string>): Target {
  const anchor = anchorOf(design, labelId)
  if (!anchor) return { blocked: "This label is not attached to a pin the Studio can find" }
  const trace = traceOf(design, source, anchor)
  const lockedName = lockedPart(design, anchor, trace, locked)
  if (lockedName !== undefined) return { blocked: `${lockedName} is locked` }
  const blocker = trace ? traceBlocker(trace) : undefined
  if (blocker) return { blocked: blocker }
  if (!trace && anchor.connection) return { blocked: "The wire of this label is not written in a trace the Studio can find" }
  if (!trace && !addressable(pinSelector(design, anchor.pin))) return { blocked: `${anchor.pin.id} has a repeated name and cannot be wired from the Studio` }
  return trace ? { anchor, trace } : { anchor }
}

/** Why the label cannot be dragged, or null when it can. */
export function labelBlocker(design: Design, source: SourceCircuit, labelId: string, locked: ReadonlySet<string> = NO_LOCKS): string | null {
  const target = targetOf(design, source, labelId, locked)
  return "blocked" in target ? target.blocked : null
}

/** The name `net.<name>` writes for the label's net. */
function netSelector(design: Design, label: NetLabel): string {
  const names = netNames(design, label)
  return `net.${names.includes(label.text) ? label.text : (names[0] ?? label.text)}`
}

/**
 * The edit that moves a label to `drop`: new corners on the trace that joins its pin to the net, or
 * a new trace from the pin to the net when there is none. Nothing when the label would not move.
 */
export function labelDragEdits(design: Design, source: SourceCircuit, labelId: string, drop: Point, locked: ReadonlySet<string> = NO_LOCKS): LabelDrag {
  const target = targetOf(design, source, labelId, locked)
  if ("blocked" in target) return target
  const { anchor, trace } = target
  const corners = cornersTo(anchor, tidy(drop)).map(tidy)
  if (sameCorners(corners, anchor.connection ? cornersNow(anchor) : [])) return []
  if (!trace) return [{ kind: "addTrace", from: pinSelector(design, anchor.pin), to: netSelector(design, anchor.label), schematicRouteHints: corners }]
  const pinFirst = trace.from !== undefined && pinOfSelector(design, trace.from)?.id === anchor.pin.id
  return [{ kind: "setTraceHints", from: trace.from ?? "", to: trace.to ?? "", schematicRouteHints: pinFirst ? corners : [...corners].reverse() }]
}
