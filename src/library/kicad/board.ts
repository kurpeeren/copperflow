// The board of a KiCad board file: the header checked (a KiCad board, a version copperflow reads, two copper layers)
// and the outline from the Edge.Cuts layer. The shapes there are handed to the DXF import's board logic, so a KiCad
// outline is read exactly as a drawing is: pieces joined into closed shapes, the largest is the outline, circles inside
// it are mounting holes, other closed shapes inside it are kept clear.
import { boardFromDrawing, DxfError, type BoardFromDrawing } from "../../engine/dxf/index.js"
import type { DxfEntity } from "../../engine/dxf/reader.js"
import type { Point } from "../../engine/model.js"
import { arcThrough, BOARD_FRAME, onBoard, pointOf, ptsPoints, type Frame } from "./geometry.js"
import { child, head, numberAt, textAt, texts, type SList } from "./sexpr.js"

export class KicadError extends Error {}

/**
 * The oldest file version read: 20211014, the version KiCad 6.0 writes (the first with `footprint` in place of
 * `module`, quoted layer names and pads whose turn includes their footprint's). Every later version is read; the
 * version is the date of the format change, written in every file's (version …).
 */
export const MIN_VERSION = 20211014

/** The newest version copperflow was tested with: the files KiCad 10.0.5 saves. A newer file is read, and the answer says so. */
export const TESTED_VERSION = 20260206
export const TESTED_KICAD = "10.0.5"

export const EDGE_LAYER = "Edge.Cuts"

/** The file's format version; refuses a file that is not a KiCad board and one older than MIN_VERSION. */
export function checkHeader(top: SList): number {
  if (head(top) !== "kicad_pcb") {
    const first = head(top) ?? "nothing"
    throw new KicadError(`This is not a KiCad board: the file starts with (${first}, not (kicad_pcb`)
  }
  const version = numberAt(child(top, "version"), 1)
  if (version === undefined) throw new KicadError("This KiCad board names no file version, so it cannot be read")
  if (version < MIN_VERSION) {
    throw new KicadError(`This board was saved by KiCad 5 or older (file version ${version}); copperflow reads boards saved by KiCad 6 or newer (version ${MIN_VERSION} on). Open it in KiCad 6 or newer and save it again.`)
  }
  return version
}

/** The copper layers the file's (layers …) names, e.g. ["F.Cu", "B.Cu"]; refuses more than two. */
export function copperLayers(top: SList): string[] {
  const names = (child(top, "layers")?.list ?? []).flatMap((node) => ("list" in node ? [textAt(node, 1) ?? ""] : [])).filter((name) => name.endsWith(".Cu"))
  if (names.length > 2) {
    throw new KicadError(`This board has ${names.length} copper layers (${names.join(", ")}); copperflow builds two-layer boards, so it cannot be imported`)
  }
  return names
}

const layerOf = (item: SList): string | undefined => textAt(child(item, "layer"), 1)

/** Whether a graphic item (gr_line, fp_arc, …) is on Edge.Cuts. */
export const onEdge = (item: SList): boolean => layerOf(item) === EDGE_LAYER || texts(child(item, "layers")).includes(EDGE_LAYER)

const degrees = (radians: number) => (radians * 180) / Math.PI

/** One Edge.Cuts shape as the DXF board logic reads it; undefined for a shape it cannot take (a curve). */
export function edgeEntity(item: SList, frame: Frame = BOARD_FRAME): DxfEntity | undefined {
  const kind = (head(item) ?? "").replace(/^(gr|fp)_/, "")
  const at = (name: string) => {
    const p = pointOf(item, name)
    return p && onBoard(frame, p)
  }
  const layer = EDGE_LAYER
  if (kind === "line") {
    const [start, end] = [at("start"), at("end")]
    return start && end ? { type: "LINE", layer, start, end } : undefined
  }
  if (kind === "arc") {
    const [start, mid, end] = [at("start"), at("mid"), at("end")]
    const arc = start && mid && end ? arcThrough(start, mid, end) : undefined
    if (!arc) return undefined
    const [from, to] = arc.sweep >= 0 ? [arc.start, arc.start + arc.sweep] : [arc.start + arc.sweep, arc.start]
    return { type: "ARC", layer, centre: arc.centre, radius: arc.radius, startAngle: degrees(from), endAngle: degrees(to) }
  }
  if (kind === "circle") {
    const [centre, end] = [at("center"), at("end")]
    return centre && end ? { type: "CIRCLE", layer, centre, radius: Math.hypot(end.x - centre.x, end.y - centre.y) } : undefined
  }
  if (kind === "rect") {
    const [a, b] = [pointOf(item, "start"), pointOf(item, "end")]
    if (!a || !b) return undefined
    const corners: Point[] = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }].map((p) => onBoard(frame, p))
    return { type: "LWPOLYLINE", layer, closed: true, vertices: corners.map((p) => ({ ...p, bulge: 0 })) }
  }
  if (kind === "poly") {
    const points = ptsPoints(child(item, "pts"), frame)
    return points.length >= 3 ? { type: "LWPOLYLINE", layer, closed: true, vertices: points.map((p) => ({ ...p, bulge: 0 })) } : undefined
  }
  return undefined
}

/** The board the Edge.Cuts shapes give; refuses a board without a closed outline. */
export function boardOf(entities: DxfEntity[], skipped: Record<string, number>, origin: "centre" | "keep" | undefined): BoardFromDrawing {
  try {
    return boardFromDrawing({ units: "mm", entities, skipped }, origin === "keep" ? { origin: "keep" } : {})
  } catch (error) {
    if (!(error instanceof DxfError)) throw error
    if (entities.length === 0) throw new KicadError(`The board has no closed outline: there is nothing on ${EDGE_LAYER}`)
    throw new KicadError(`The board has no closed outline on ${EDGE_LAYER}: ${error.message.replace(/^No closed shape was found: /, "found ")}`)
  }
}
