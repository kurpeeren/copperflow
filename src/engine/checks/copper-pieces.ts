import { COPPER_LAYERS, type CopperLayer } from "../../core/layout-file.js"
import { viaSpan, type PcbTrack, type PcbVia } from "../copper.js"
import type { BoardGraphic, Point } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PcbLayout, WorldPad } from "../pcb.js"
import { DEFAULT_CLASS } from "../rules/profiles.js"
import { padShape, type Shape } from "./geometry.js"

/**
 * The copper the copper checks measure, each piece with its net, class, layers and outline. A track
 * is one shape per segment (a segment grown by half the width); a via is its ring's disc over every
 * layer it spans; a pad is its outline on its own side, or on every layer for a through pad.
 */
export interface CopperPiece {
  id: string
  kind: "pad" | "track" | "via" | "drawing"
  net?: string
  className: string
  layers: readonly CopperLayer[]
  shapes: Shape[]
  /** Where to point at the piece alone: a track's first point, a via's or a pad's centre. */
  at: Point
  /** For a track, the pads copper.ts joined it to. */
  pads?: readonly string[]
}

export type ClassOf = (net: string | undefined) => string

const withNet = (net: string | undefined) => (net === undefined ? {} : { net })

function padLayers(pad: WorldPad): readonly CopperLayer[] {
  return pad.layers === "through" ? COPPER_LAYERS : [pad.layers]
}

/** A pad without a net is in the default class, whatever classOf says. */
function padPiece(pad: WorldPad, classOf: ClassOf): CopperPiece | undefined {
  const shape = padShape(pad)
  if (shape === undefined) return undefined
  const className = pad.net === undefined ? DEFAULT_CLASS.name : classOf(pad.net)
  return { id: pad.id, kind: "pad", ...withNet(pad.net), className, layers: padLayers(pad), shapes: [shape], at: { x: pad.x, y: pad.y } }
}

function segments(track: PcbTrack): Shape[] {
  const radius = track.width / 2
  if (track.points.length === 1) return [{ core: [track.points[0] as Point], radius }]
  return track.points.slice(1).map((p, i) => ({ core: [track.points[i] as Point, p], radius }))
}

function trackPiece(track: PcbTrack, classOf: ClassOf): CopperPiece {
  const at = track.points[0] ?? { x: 0, y: 0 }
  return { id: track.id, kind: "track", ...withNet(track.net), className: classOf(track.net), layers: [track.layer], shapes: segments(track), at, pads: track.pads }
}

function viaPiece(via: PcbVia, classOf: ClassOf): CopperPiece {
  const shape = { core: [via.at], radius: via.diameter / 2 }
  return { id: via.id, kind: "via", ...withNet(via.net), className: classOf(via.net), layers: [...viaSpan(via)], shapes: [shape], at: via.at }
}

/** The pads with a shape the checks know; unknown shapes are reported by the pad checks. */
export function padPieces(layout: PcbLayout, classOf: ClassOf): CopperPiece[] {
  return layout.parts.flatMap((part) => part.pads).flatMap((pad) => padPiece(pad, classOf) ?? [])
}

/** The private net a drawing on copper is given inside the checks and the router: never a real net's name. */
export const drawingNet = (id: string): string => `\u0000drawing ${id}`
/** Whether a piece's net is a drawing's private one, so a message does not show it as a net. */
export const isDrawingNet = (net: string | undefined): boolean => net?.startsWith("\u0000drawing ") === true

/**
 * A drawing on copper (`<boardgraphic layer="top|bottom|inner1|inner2">`) as one piece: its filled areas as triangles
 * (its holes left open, so copper inside a hole is inside no shape), its lines as segments of their width. On a net
 * it is that net's copper, in that net's class; without one it has a private net of its own, so the clearance rules
 * keep every net, and every other drawing, clear of it.
 */
function drawingPiece(graphic: BoardGraphic, classOf: ClassOf): CopperPiece {
  const lines = graphic.lines.flatMap((line): Shape[] =>
    line.points.length === 1 ? [{ core: [line.points[0] as Point], radius: line.width / 2 }] : line.points.slice(1).map((p, i) => ({ core: [line.points[i] as Point, p], radius: line.width / 2 })),
  )
  const shapes = [...(graphic.triangles ?? []).map((core): Shape => ({ core, radius: 0 })), ...lines]
  const [net, className] = graphic.net === undefined ? [drawingNet(graphic.id), DEFAULT_CLASS.name] : [graphic.net, classOf(graphic.net)]
  return { id: graphic.id, kind: "drawing", net, className, layers: [graphic.layer as CopperLayer], shapes, at: { x: graphic.x, y: graphic.y } }
}

/** The drawings on copper layers the board has, as pieces; none on a board without them. */
export function drawingPieces(layout: PcbLayout, classOf: ClassOf): CopperPiece[] {
  const graphics = layout.graphics
  if (graphics === undefined || graphics.length === 0) return []
  return graphics.filter((graphic) => (COPPER_LAYERS as readonly string[]).includes(graphic.layer)).map((graphic) => drawingPiece(graphic, classOf))
}

/** The tracks, vias and drawings on copper on layers the board has, in natural id order; copper on a missing layer is only a copper-layer error. */
export function copperPieces(layout: PcbLayout, classOf: ClassOf): CopperPiece[] {
  const onBoard = <T extends { missingLayer?: unknown }>(item: T) => item.missingLayer === undefined
  const pieces = [...layout.tracks.filter(onBoard).map((track) => trackPiece(track, classOf)), ...layout.vias.filter(onBoard).map((via) => viaPiece(via, classOf)), ...drawingPieces(layout, classOf)]
  return pieces.filter((piece) => piece.shapes.length > 0).sort((a, b) => naturalCompare(a.id, b.id))
}
