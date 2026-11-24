// A built design's board as an EasyEDA Standard PCB document (the JSON its editor saves and opens, docType "3"): the
// board outline, each part as a footprint with its pads, nets, silkscreen and designator, the tracks, vias and
// non-plated holes, the board's own texts and drawings, and the copper pours as copper areas (their outlines; the
// editor fills them when its copper areas are rebuilt). Net names are kept, so the editor's ratlines and design-rule
// check see the same connections. What is not written is listed in `left`. Pure and deterministic.
import { boardCopperLayers, type CopperLayer } from "../../core/layout-file.js"
import type { Design } from "../design.js"
import type { BoardGraphicLayer, Point } from "../model.js"
import { DEFAULT_CLASS } from "../rules/profiles.js"
import { DEFAULT_MASK_EXPANSION, designatorPlacements, printedName, silkClearance } from "./designators.js"
import { partString, textStart, type NetName, type NextId } from "./easyeda-parts.js"
import {
  copperAreaShape,
  holeShape,
  LAYER,
  num,
  ORIGIN,
  solidRegionShape,
  textShape,
  toDocument,
  trackShape,
  units,
  viaShape,
} from "./easyeda-shapes.js"
import { OUTLINE_WIDTH, withCutIns } from "./layers.js"
import { silkTextLineWidth, silkTextStrokes } from "./silk-text-strokes.js"
import { textWidth } from "./stroke-font.js"

export interface EasyedaDocument {
  head: {
    docType: "3"
    editorVersion: string
    newgId: true
    c_para: Record<string, string>
    x: string
    y: string
    hasIdFlag: true
    importFlag: 0
    transformList: ""
  }
  canvas: string
  shape: string[]
  layers: string[]
  objects: string[]
  BBox: { x: number; y: number; width: number; height: number }
  preference: { hideFootprints: string; hideNets: string }
  DRCRULE: {
    Default: { trackWidth: number; clearance: number; viaHoleDiameter: number; viaHoleD: number }
    isRealtime: boolean
    isDrcOnRoutingOrPlaceVia: boolean
    checkObjectToCopperarea: boolean
    showDRCRangeLine: boolean
  }
  netColors: Record<string, string>
}

export interface EasyedaCounts {
  parts: number
  pads: number
  tracks: number
  vias: number
  holes: number
  pours: number
  texts: number
  nets: number
}

export interface EasyedaExport {
  document: EasyedaDocument
  counts: EasyedaCounts
  /** What the document does not hold, in words: one line per kind of thing left out. */
  left: string[]
}

/** The editor version the document claims; the format's fields here are the ones that version writes. */
const EDITOR_VERSION = "6.5.61"
/** The canvas grid in format units: 1 mm. */
const GRID = 3.937
const COPPER_LAYER: Readonly<Record<CopperLayer, number>> = { top: LAYER.top, bottom: LAYER.bottom, inner1: LAYER.inner1, inner2: LAYER.inner2 }
const GRAPHIC_LAYER: Readonly<Record<BoardGraphicLayer, number>> = {
  "top-silkscreen": LAYER.topSilk,
  "bottom-silkscreen": LAYER.bottomSilk,
  "top-mask": LAYER.topMask,
  "bottom-mask": LAYER.bottomMask,
  ...COPPER_LAYER,
}

/** The layer table: id, name and colour; the inner layers are in use only on a 4-layer board. */
const LAYER_TABLE: readonly (readonly [number | string, string, string])[] = [
  [LAYER.top, "TopLayer", "#FF0000"],
  [LAYER.bottom, "BottomLayer", "#0000FF"],
  [LAYER.topSilk, "TopSilkLayer", "#FFCC00"],
  [LAYER.bottomSilk, "BottomSilkLayer", "#66CC33"],
  [LAYER.topPaste, "TopPasteMaskLayer", "#808080"],
  [LAYER.bottomPaste, "BottomPasteMaskLayer", "#800000"],
  [LAYER.topMask, "TopSolderMaskLayer", "#800080"],
  [LAYER.bottomMask, "BottomSolderMaskLayer", "#AA00FF"],
  [9, "Ratlines", "#6464FF"],
  [LAYER.outline, "BoardOutLine", "#FF00FF"],
  [LAYER.multi, "Multi-Layer", "#C0C0C0"],
  [LAYER.document, "Document", "#FFFFFF"],
  [LAYER.topAssembly, "TopAssembly", "#33CC99"],
  [LAYER.bottomAssembly, "BottomAssembly", "#5555FF"],
  [LAYER.inner1, "Inner1", "#999966"],
  [LAYER.inner2, "Inner2", "#008000"],
  ["Hole", "Hole", "#222222"],
]
const OBJECTS = ["All", "Component", "Prefix", "Name", "Track", "Pad", "Via", "Hole", "Copper_Area", "Circle", "Arc", "Solid_Region", "Text", "Image", "Rect", "Dimension", "Protractor"]

function layerTable(layers: 2 | 4): string[] {
  const inner = new Set<number | string>([LAYER.inner1, LAYER.inner2])
  const assembly = new Set<number | string>([LAYER.topAssembly, LAYER.bottomAssembly])
  return LAYER_TABLE.map(([id, name, colour]) => {
    const used = inner.has(id) ? layers === 4 : !assembly.has(id)
    return `${id}~${name}~${colour}~${used}~${id === LAYER.top}~${used}~`
  })
}

/**
 * Names nets for the document: a net's id without the "net." prefix, with the format's separators made "_" ("net"
 * when nothing is left); a name another net already has gets "_2", "_3" and so on, so two nets never become one. The
 * ids given come first, in order; any other id is named the first time it is asked for, against the same names.
 */
export function netNamer(ids: readonly string[]): NetName {
  const names = new Map<string, string>()
  const taken = new Set<string>()
  const name = (id: string): string => {
    const known = names.get(id)
    if (known !== undefined) return known
    const base = (id.startsWith("net.") ? id.slice("net.".length) : id).replace(/[~`]/g, "_").split("#@$").join("_") || "net"
    let chosen = base
    for (let n = 2; taken.has(chosen); n++) chosen = `${base}_${n}`
    taken.add(chosen)
    names.set(id, chosen)
    return chosen
  }
  ids.forEach(name)
  return (id) => (id === undefined ? "" : name(id))
}

/** Each id's name in the document, as netNamer gives them. */
export function netNames(ids: readonly string[]): Map<string, string> {
  const namer = netNamer(ids)
  return new Map(ids.map((id) => [id, namer(id)]))
}

function counter(): NextId {
  let next = 0
  return () => `gge${++next}`
}

/** The outline's box in format units, or the origin when the board has no outline. */
function boundingBox(outline: readonly Point[]): EasyedaDocument["BBox"] {
  if (outline.length === 0) return { x: ORIGIN.x, y: ORIGIN.y, width: 0, height: 0 }
  const points = outline.map(toDocument)
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const [x, y] = [Math.min(...xs), Math.min(...ys)]
  return { x: Number(num(x)), y: Number(num(y)), width: Number(num(Math.max(...xs) - x)), height: Number(num(Math.max(...ys) - y)) }
}

/** The board's own texts as free texts on the silkscreen, drawn as the Gerber legend draws them. */
function silkTextShapes(design: Design, nextId: NextId): string[] {
  return (design.pcb.silkTexts ?? []).map((text) => {
    const bottom = text.layer === "bottom"
    return textShape({
      kind: "L",
      start: textStart(text, textWidth(text.text, text.height), text.height, text.rotation, bottom),
      lineWidth: silkTextLineWidth(text.height),
      rotation: text.rotation,
      mirrored: bottom,
      layer: bottom ? LAYER.bottomSilk : LAYER.topSilk,
      height: text.height,
      text: text.text,
      strokes: silkTextStrokes(text),
      shown: true,
      id: nextId(),
    })
  })
}

/** The board's drawings: each filled area one solid region (its holes joined in), each line a track, on its layer. */
function graphicShapes(design: Design, netName: NetName, nextId: NextId): string[] {
  return (design.pcb.graphics ?? []).flatMap((graphic) => {
    const layer = GRAPHIC_LAYER[graphic.layer]
    const net = netName(graphic.net)
    return [
      ...graphic.areas.map((area) => solidRegionShape({ layer, net, ring: withCutIns(area), id: nextId() })),
      ...graphic.lines.filter((line) => line.points.length > 1).map((line) => trackShape({ width: line.width, layer, net, points: line.points, id: nextId() })),
    ]
  })
}

/** A ring needs this many corners to enclose an area. */
const RING_CORNERS = 3

/**
 * The copper pours as copper areas round their own outline, or the board's; a pour on a layer the board lacks, or with
 * no area to fill, is left out.
 */
function pourShapes(design: Design, netName: NetName, nextId: NextId, clearance: number): string[] {
  const board = design.pcb.board
  if (board === undefined) return []
  const copper = boardCopperLayers(board.layers)
  return (board.pours ?? [])
    .map((pour) => ({ pour, outline: pour.outline ?? board.outline }))
    .filter(({ pour, outline }) => copper.includes(pour.layer) && outline.length >= RING_CORNERS)
    .map(({ pour, outline }) =>
      copperAreaShape({
        minWidth: pour.minWidth,
        layer: COPPER_LAYER[pour.layer],
        net: netName(pour.net),
        outline,
        clearance: pour.clearance ?? clearance,
        thermal: pour.thermal === "relief" ? "spoke" : "direct",
        id: nextId(),
      }),
    )
}

/** One line per kind of thing the document leaves out, naming them; empty when nothing is. */
function leftOut(design: Design): string[] {
  const pcb = design.pcb
  const named = (what: string, ids: readonly string[]) => (ids.length === 0 ? [] : [`${what}: ${ids.join(", ")}`])
  return [
    ...named("Parts without a footprint (no pads to write)", pcb.parts.filter((part) => part.footprint === undefined).map((part) => part.component)),
    ...named("Tracks on a copper layer the board lacks", pcb.tracks.filter((track) => track.missingLayer !== undefined).map((track) => track.id)),
    ...named("Vias on a copper layer the board lacks", pcb.vias.filter((via) => via.missingLayer !== undefined).map((via) => via.id)),
    ...named("Keepouts (the format has no keepout the export can rely on)", (pcb.board?.keepouts ?? []).map((keepout) => keepout.id)),
  ]
}

/** The design's board as an EasyEDA Standard PCB document, with what it holds and what it leaves out. */
export function easyedaExport(design: Design): EasyedaExport {
  const pcb = design.pcb
  const nextId = counter()
  const netName = netNamer(design.circuit.nets.map((net) => net.id))
  const rule = design.rules.classes.find((c) => c.name === DEFAULT_CLASS.name) ?? DEFAULT_CLASS
  const values = new Map(design.circuit.components.map((component) => [component.id, component.value]))
  const fabrication = design.rules.fabrication
  const designators = new Map(designatorPlacements(pcb, fabrication.maskExpansion ?? DEFAULT_MASK_EXPANSION, silkClearance(fabrication)).map((placed) => [placed.component, placed]))
  const outline = pcb.board?.outline ?? []
  const tracks = pcb.tracks.filter((track) => track.missingLayer === undefined)
  const vias = pcb.vias.filter((via) => via.missingLayer === undefined)
  const outlineShape = outline.length < 2 ? [] : [trackShape({ width: OUTLINE_WIDTH, layer: LAYER.outline, net: "", points: [...outline, outline[0] as Point], id: nextId() })]
  const pours = pourShapes(design, netName, nextId, rule.clearance)
  const parts = pcb.parts.flatMap((part) => {
    const value = values.get(part.component)
    const designator = designators.get(part.component)
    const lib = partString({ part, name: printedName(part), ...(designator ? { designator } : {}), ...(value !== undefined ? { value } : {}) }, netName, nextId)
    return lib === undefined ? [] : [lib]
  })
  const texts = silkTextShapes(design, nextId)
  const shape = [
    ...outlineShape,
    ...pours,
    ...tracks.map((track) => trackShape({ width: track.width, layer: COPPER_LAYER[track.layer], net: netName(track.net), points: track.points, id: nextId() })),
    ...vias.map((via) => viaShape({ at: via.at, diameter: via.diameter, drill: via.drill, net: netName(via.net), id: nextId() })),
    ...pcb.holes.map((hole) => holeShape({ at: hole, diameter: hole.diameter, id: nextId() })),
    ...parts,
    ...texts,
    ...graphicShapes(design, netName, nextId),
  ]
  const placed = pcb.parts.filter((part) => part.footprint !== undefined)
  const document: EasyedaDocument = {
    head: { docType: "3", editorVersion: EDITOR_VERSION, newgId: true, c_para: {}, x: num(ORIGIN.x), y: num(ORIGIN.y), hasIdFlag: true, importFlag: 0, transformList: "" },
    canvas: ["CA", 1000, 1000, "#000000", "yes", "#FFFFFF", GRID, 1000, 1000, "line", 0.5, "mm", units(rule.trackWidth), 45, "visible", 0.5, num(ORIGIN.x), num(ORIGIN.y)].join("~"),
    shape,
    layers: layerTable(pcb.board?.layers ?? 2),
    objects: OBJECTS.map((name) => `${name}~true~${name === "All" || name === "Name" ? "false" : "true"}`),
    BBox: boundingBox(outline),
    preference: { hideFootprints: "", hideNets: "" },
    DRCRULE: {
      Default: { trackWidth: Number(units(rule.trackWidth)), clearance: Number(units(rule.clearance)), viaHoleDiameter: Number(units(rule.via.diameter)), viaHoleD: Number(units(rule.via.drill)) },
      isRealtime: true,
      isDrcOnRoutingOrPlaceVia: false,
      checkObjectToCopperarea: true,
      showDRCRangeLine: true,
    },
    netColors: {},
  }
  const counts: EasyedaCounts = {
    parts: placed.length,
    pads: placed.reduce((sum, part) => sum + part.pads.length, 0),
    tracks: tracks.length,
    vias: vias.length,
    holes: pcb.holes.length,
    pours: pours.length,
    texts: texts.length,
    nets: design.circuit.nets.length,
  }
  return { document, counts, left: leftOut(design) }
}

/** The document as the file's text: JSON, two-space indented, ending in a newline. */
export const easyedaText = (document: EasyedaDocument): string => `${JSON.stringify(document, null, 2)}\n`
