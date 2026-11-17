// The footprints of a KiCad board: each one's designator, value, side, place and turn, and its pads both on the board
// and as a land pattern copperflow can store (footprint.yaml: y up, origin at the part's anchor, seen from the top).
//
// Turns and sides. A footprint at (x, y) turned θ puts its pads where KiCad says (geometry.ts). In copperflow a part
// on the top is turned counter-clockwise by pcbRotation; one on the bottom is turned, then mirrored left to right. So:
// - top:    pcbRotation = θ,        a pad at (lx, ly) in the file is at (lx, -ly) in the land pattern;
// - bottom: pcbRotation = 180 - θ,  a pad at (lx, ly) in the file is at (lx, ly) in the land pattern.
// KiCad stores a flipped footprint's pads mirrored top to bottom, so the bottom rule gives back the land pattern as it
// was on the top, and a part used on both sides is one library part. A pad's turn in the land pattern is its turn in
// the file less θ (top) or θ less it (bottom), modulo 180: every pad shape copperflow draws looks the same half a turn on.
import type { DxfEntity } from "../../engine/dxf/reader.js"
import type { Point } from "../../engine/model.js"
import { edgeEntity, onEdge } from "./board.js"
import { onBoard, tidy, turn360, up, type Frame } from "./geometry.js"
import { child, children, flag, head, isList, numberAt, textAt, texts, type SList } from "./sexpr.js"
import type { Tally } from "./tally.js"

export type PadShape = "rect" | "roundrect" | "circle" | "oval"

export interface KicadPad {
  /** The pad's number (name) as the file writes it; "" for an unnamed pad. */
  number: string
  /** The pin function the file records, e.g. "VCC". */
  function?: string
  /** The electrical type the file records, e.g. "input". */
  type?: string
  shape: PadShape
  /** In the land pattern: mm, y up, around the part's anchor, as seen from the top. */
  x: number
  y: number
  width: number
  height: number
  rotation: number
  layers: "top" | "through"
  drill?: number | { width: number; height: number }
  /** The net's name in the file. */
  net?: string
  /** What the file had that copperflow draws differently, e.g. "a custom pad", for the part's checklist. */
  approximated?: string
  /** Where the pad's centre is on the board, before the board is centred. */
  world: Point
}

export interface KicadPart {
  ref: string
  value: string
  /** The footprint's library name, e.g. "Resistor_SMD:R_0603_1608Metric". */
  footprint: string
  side: "top" | "bottom"
  /** The anchor on the board, before the board is centred. */
  at: Point
  /** copperflow's pcbRotation. */
  rotation: number
  pads: KicadPad[]
}

export interface ReadFootprints {
  parts: KicadPart[]
  /** Unplated holes, before the board is centred. */
  holes: { x: number; y: number; diameter: number }[]
  /** Edge.Cuts shapes the footprints hold, on the board. */
  edges: DxfEntity[]
  /** Zones a footprint holds (their points are on the board already). */
  zones: SList[]
  /** "H1" for a footprint that held only unplated holes. */
  holeOnly: string[]
}

/** Footprint children that carry nothing copperflow keeps: names, ids, settings of the pads. */
const QUIET = new Set([
  "layer", "at", "uuid", "tstamp", "tedit", "path", "sheetname", "sheetfile", "descr", "tags", "attr", "locked", "placed",
  "embedded_fonts", "embedded_files", "net_tie_pad_groups", "duplicate_pad_numbers_are_jumpers", "jumper_pad_groups",
  "solder_mask_margin", "solder_paste_margin", "solder_paste_ratio", "solder_paste_margin_ratio", "clearance", "zone_connect",
  "thermal_width", "thermal_gap", "autoplace_cost90", "autoplace_cost180", "private_layers", "component_classes", "group",
  "generator", "generator_version", "version", "units", "net_tie_pad_groups", "stackup", "component_class",
])
const GRAPHICS = new Set(["fp_line", "fp_arc", "fp_circle", "fp_rect", "fp_poly", "fp_curve", "fp_bezier"])

/** A pad's net name: (net "GND") in KiCad 10, (net 3 "GND") before, or (net 3) with the board's table. */
export function netName(item: SList, table: ReadonlyMap<number, string>): string | undefined {
  const net = child(item, "net")
  if (!net) return undefined
  const number = numberAt(net, 1)
  const name = number === undefined ? textAt(net, 1) : (textAt(net, 2) ?? table.get(number))
  return name === undefined || name === "" ? undefined : name
}

/** A footprint's property (KiCad 8 on) or fp_text (KiCad 6 and 7) of this kind. */
function fieldText(fp: SList, property: string, textKind: string): string | undefined {
  const prop = children(fp, "property").find((p) => textAt(p, 1) === property)
  if (prop) return textAt(prop, 2)
  return textAt(children(fp, "fp_text").find((t) => textAt(t, 1) === textKind), 2)
}

const halfTurn = (degrees: number) => tidy(((degrees % 180) + 180) % 180)

function drillOf(pad: SList): KicadPad["drill"] | undefined {
  const drill = child(pad, "drill")
  if (!drill) return undefined
  if (textAt(drill, 1) === "oval") {
    const [w, h] = [numberAt(drill, 2), numberAt(drill, 3)]
    if (w === undefined || w <= 0) return undefined
    return h === undefined || h === w ? w : { width: w, height: h }
  }
  const d = numberAt(drill, 1)
  return d !== undefined && d > 0 ? d : undefined
}

/** The shape copperflow draws a pad with; `approximated` when that is not the file's shape. */
function shapeOf(pad: SList): { shape: PadShape; approximated: boolean } {
  const kind = textAt(pad, 3)
  if (kind === "rect" || kind === "circle" || kind === "oval") return { shape: kind, approximated: false }
  if (kind === "roundrect") return { shape: "roundrect", approximated: (numberAt(child(pad, "chamfer_ratio"), 1) ?? 0) > 0 && child(pad, "chamfer") !== undefined }
  if (kind === "custom") {
    const options = child(pad, "options")
    return { shape: options && textAt(child(options, "anchor"), 1) === "circle" ? "circle" : "rect", approximated: true }
  }
  return { shape: "rect", approximated: true }
}

interface PartContext {
  ref: string
  frame: Frame
  side: "top" | "bottom"
  nets: ReadonlyMap<number, string>
  tally: Tally
  holes: ReadFootprints["holes"]
}

/** One copper pad, or undefined for an unplated hole (added to the holes) or a pad on the far side. */
function readPad(pad: SList, ctx: PartContext): KicadPad | undefined {
  const at = child(pad, "at")
  const [px, py, angle] = [numberAt(at, 1) ?? 0, numberAt(at, 2) ?? 0, numberAt(at, 3) ?? 0]
  const world = onBoard(ctx.frame, up(px, py))
  const number = textAt(pad, 1) ?? ""
  const label = `${ctx.ref}.${number || "(unnamed)"}`
  const drill = drillOf(pad)
  const attribute = textAt(pad, 2)
  if (attribute === "np_thru_hole") {
    if (drill === undefined) return undefined
    const diameter = typeof drill === "number" ? drill : Math.min(drill.width, drill.height)
    if (typeof drill !== "number") ctx.tally.add("approximated", 1, `${label} (an oval hole drilled round)`)
    ctx.holes.push({ x: world.x, y: world.y, diameter })
    return undefined
  }
  const layers = texts(child(pad, "layers"))
  const own = ctx.side === "top" ? "F.Cu" : "B.Cu"
  const through = attribute === "thru_hole" && drill !== undefined
  if (!through && !layers.includes(own) && !layers.includes("*.Cu")) {
    ctx.tally.add("farPads", 1, label)
    return undefined
  }
  const size = child(pad, "size")
  const [width, height] = [numberAt(size, 1) ?? 0, numberAt(size, 2) ?? numberAt(size, 1) ?? 0]
  if (width <= 0 || height <= 0) return undefined
  const { shape, approximated } = shapeOf(pad)
  const notes: string[] = []
  if (approximated) {
    ctx.tally.add("approximated", 1, `${label} (${textAt(pad, 3) ?? "unknown"} as ${shape})`)
    notes.push(`a ${textAt(pad, 3) ?? "unknown"} pad, drawn as ${shape}`)
  }
  if (through && child(child(pad, "drill") as SList, "offset")) {
    ctx.tally.add("approximated", 1, `${label} (drill offset from the pad's centre, drilled at the centre)`)
    notes.push("drilled off its centre, drilled at the centre here")
  }
  const top = ctx.side === "top"
  const fn = textAt(child(pad, "pinfunction"), 1)
  const type = textAt(child(pad, "pintype"), 1)
  const net = netName(pad, ctx.nets)
  return {
    number,
    ...(fn ? { function: fn } : {}),
    ...(type ? { type } : {}),
    shape,
    x: tidy(px),
    y: tidy(top ? -py : py),
    width,
    height,
    rotation: shape === "circle" ? 0 : halfTurn(top ? angle - ctx.frame.angle : ctx.frame.angle - angle),
    layers: through ? "through" : "top",
    ...(through && drill !== undefined ? { drill } : {}),
    ...(net ? { net } : {}),
    ...(notes.length > 0 ? { approximated: notes.join(" and ") } : {}),
    world,
  }
}

/** The footprint's other children: drawings, texts, models, Edge.Cuts shapes, zones, and what is not understood. */
function readExtras(fp: SList, ctx: PartContext, found: ReadFootprints): void {
  for (const node of fp.list.slice(2)) {
    if (!isList(node)) continue
    const name = head(node) ?? ""
    if (GRAPHICS.has(name)) {
      if (!onEdge(node)) ctx.tally.add("drawings")
      else {
        const entity = edgeEntity(node, ctx.frame)
        if (entity) found.edges.push(entity)
        else ctx.tally.add("edgeLeft", 1, name)
      }
    } else if (name === "fp_text") {
      if (textAt(node, 1) === "user") ctx.tally.add("texts")
    } else if (name === "fp_text_box") ctx.tally.add("texts")
    else if (name === "model") ctx.tally.add("models")
    else if (name === "zone") found.zones.push(node)
    else if (name === "dimension") ctx.tally.add("dimensions")
    else if (name !== "pad" && name !== "property" && !QUIET.has(name)) ctx.tally.skip(name)
  }
}

function readFootprint(fp: SList, nets: ReadonlyMap<number, string>, tally: Tally, found: ReadFootprints): void {
  const at = child(fp, "at")
  const [x, y, angle] = [numberAt(at, 1) ?? 0, numberAt(at, 2) ?? 0, numberAt(at, 3) ?? 0]
  const side = textAt(child(fp, "layer"), 1) === "B.Cu" ? "bottom" : "top"
  const ref = fieldText(fp, "Reference", "reference") ?? ""
  const ctx: PartContext = { ref: ref || "(no designator)", frame: { at: up(x, y), angle }, side, nets, tally, holes: found.holes }
  if (flag(fp, "locked")) tally.add("locked")
  readExtras(fp, ctx, found)
  const holesBefore = found.holes.length
  const pads = children(fp, "pad").flatMap((pad) => readPad(pad, ctx) ?? [])
  if (pads.length === 0) {
    if (found.holes.length > holesBefore) found.holeOnly.push(ctx.ref)
    else tally.add("padless", 1, ctx.ref)
    return
  }
  found.parts.push({
    ref,
    value: fieldText(fp, "Value", "value") ?? "",
    footprint: textAt(fp, 1) ?? "",
    side,
    at: up(x, y),
    rotation: tidy(turn360(side === "top" ? angle : 180 - angle)),
    pads,
  })
}

/** Every footprint of the board. */
export function readFootprints(top: SList, nets: ReadonlyMap<number, string>, tally: Tally): ReadFootprints {
  const found: ReadFootprints = { parts: [], holes: [], edges: [], zones: [], holeOnly: [] }
  for (const fp of children(top, "footprint")) readFootprint(fp, nets, tally, found)
  return found
}
