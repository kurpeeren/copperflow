// A KiCad board file read into what copperflow can write: the board, the parts with their pads, the nets, the copper,
// and a tally of what does not come over. Pure: no file system. Every coordinate is copperflow's: mm, y up, and the
// outline's box centred on the origin unless the origin is kept.
import type { BoardFromDrawing } from "../../engine/dxf/index.js"
import type { DxfEntity } from "../../engine/dxf/reader.js"
import type { Point } from "../../engine/model.js"
import { boardOf, checkHeader, copperLayers, edgeEntity, KicadError, onEdge } from "./board.js"
import { readCopper, type KicadPour, type KicadTrack, type KicadVia } from "./copper.js"
import { readFootprints, type KicadPart } from "./footprints.js"
import { moved, tidy } from "./geometry.js"
import { children, head, isList, numberAt, readSexpr, SexprError, textAt, type SList } from "./sexpr.js"
import { Tally } from "./tally.js"

export { KicadError }

export interface KicadBoard {
  version: number
  board: BoardFromDrawing
  parts: KicadPart[]
  /** Footprints that held only unplated holes, now board holes. */
  holeOnly: string[]
  tracks: KicadTrack[]
  vias: KicadVia[]
  pours: KicadPour[]
  held: { footprints: number; segments: number; arcs: number; arcPieces: number; vias: number; zones: number; nets: number }
  left: Tally
}

/** Top-level items that carry nothing copperflow keeps. */
const QUIET = new Set(["version", "generator", "generator_version", "general", "paper", "page", "title_block", "layers", "embedded_fonts", "embedded_files", "group", "generated", "uuid", "property", "net", "footprint", "segment", "arc", "via", "zone"])
const GRAPHICS = new Set(["gr_line", "gr_arc", "gr_circle", "gr_rect", "gr_poly", "gr_curve", "gr_bezier"])
const TEXTS = new Set(["gr_text", "gr_text_box", "table"])

/** The board's (net 3 "GND") table, which files before KiCad 10 point to by number. */
function netTable(top: SList): Map<number, string> {
  const table = new Map<number, string>()
  for (const net of children(top, "net")) {
    const number = numberAt(net, 1)
    const name = textAt(net, 2)
    if (number !== undefined && name !== undefined) table.set(number, name)
  }
  return table
}

/** Edge.Cuts shapes and the tally of the other top-level items. */
function topLevel(top: SList, tally: Tally): { edges: DxfEntity[]; skipped: Record<string, number> } {
  const edges: DxfEntity[] = []
  const skipped: Record<string, number> = {}
  for (const node of top.list.slice(1)) {
    if (!isList(node)) continue
    const name = head(node) ?? "(list)"
    if (GRAPHICS.has(name)) {
      if (!onEdge(node)) tally.add("drawings")
      else {
        const entity = edgeEntity(node)
        if (entity) edges.push(entity)
        else skipped[name] = (skipped[name] ?? 0) + 1
      }
    } else if (TEXTS.has(name)) tally.add("texts")
    else if (name === "dimension") tally.add("dimensions")
    else if (name === "setup" || name === "net_class") tally.add("rules")
    else if (!QUIET.has(name)) tally.skip(name)
  }
  return { edges, skipped }
}

const movedPart = (part: KicadPart, offset: Point): KicadPart => ({
  ...part,
  at: moved(part.at, offset),
  pads: part.pads.map((pad) => ({ ...pad, world: moved(pad.world, offset) })),
})

/** The nets the file names, counted once each: those its pads, tracks, vias and zones use. */
function netCount(parts: readonly KicadPart[], copper: { tracks: KicadTrack[]; vias: KicadVia[]; pours: KicadPour[] }): number {
  const names = new Set<string>()
  for (const part of parts) for (const pad of part.pads) if (pad.net) names.add(pad.net)
  for (const item of [...copper.tracks, ...copper.vias, ...copper.pours]) if (item.net) names.add(item.net)
  return names.size
}

/** Reads a KiCad board's text; throws KicadError with a sentence for the person. */
export function readKicadBoard(text: string, options: { origin?: "centre" | "keep" } = {}): KicadBoard {
  let top: SList
  try {
    top = readSexpr(text)
  } catch (error) {
    if (error instanceof SexprError) throw new KicadError(`This is not a KiCad board, or it is damaged: ${error.message}`)
    throw error
  }
  const version = checkHeader(top)
  copperLayers(top)
  const tally = new Tally()
  const nets = netTable(top)
  const { edges, skipped } = topLevel(top, tally)
  const footprints = readFootprints(top, nets, tally)
  const copper = readCopper(top, footprints.zones, nets, tally)
  const board = boardOf([...edges, ...footprints.edges], skipped, options.origin)
  for (const line of board.notUsed) tally.add("edgeLeft", Number(/^\d+/.exec(line)?.[0] ?? 1), line)
  const offset = board.offset
  const holes = footprints.holes.map((hole) => ({ ...moved(hole, offset), diameter: tidy(hole.diameter) }))
  return {
    version,
    board: { ...board, holes: [...board.holes, ...holes], keepouts: [...board.keepouts, ...copper.keepouts.map((k) => k.map((p) => moved(p, offset)))] },
    parts: footprints.parts.map((part) => movedPart(part, offset)),
    holeOnly: footprints.holeOnly,
    tracks: copper.tracks.map((t) => ({ ...t, points: t.points.map((p) => moved(p, offset)) })),
    vias: copper.vias.map((v) => ({ ...v, at: moved(v.at, offset) })),
    pours: copper.pours.map((p) => ({ ...p, outline: p.outline.map((q) => moved(q, offset)) })),
    held: { footprints: children(top, "footprint").length, ...copper.held, nets: netCount(footprints.parts, copper) },
    left: tally,
  }
}
