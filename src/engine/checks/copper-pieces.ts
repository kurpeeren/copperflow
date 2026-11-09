import { COPPER_LAYERS, type CopperLayer } from "../../core/layout-file.js"
import { viaSpan, type PcbTrack, type PcbVia } from "../copper.js"
import type { Point } from "../model.js"
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
  kind: "pad" | "track" | "via"
  net?: string
  className: string
  layers: readonly CopperLayer[]
  shapes: Shape[]
  /** Where to point at the piece alone: a track's first point, a via's or a pad's centre. */
  at: Point
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
  return { id: track.id, kind: "track", ...withNet(track.net), className: classOf(track.net), layers: [track.layer], shapes: segments(track), at }
}

function viaPiece(via: PcbVia, classOf: ClassOf): CopperPiece {
  const shape = { core: [via.at], radius: via.diameter / 2 }
  return { id: via.id, kind: "via", ...withNet(via.net), className: classOf(via.net), layers: [...viaSpan(via)], shapes: [shape], at: via.at }
}

/** The pads with a shape the checks know; unknown shapes are reported by the pad checks. */
export function padPieces(layout: PcbLayout, classOf: ClassOf): CopperPiece[] {
  return layout.parts.flatMap((part) => part.pads).flatMap((pad) => padPiece(pad, classOf) ?? [])
}

/** The tracks and vias, in natural id order. */
export function copperPieces(layout: PcbLayout, classOf: ClassOf): CopperPiece[] {
  const pieces = [...layout.tracks.map((track) => trackPiece(track, classOf)), ...layout.vias.map((via) => viaPiece(via, classOf))]
  return pieces.filter((piece) => piece.shapes.length > 0).sort((a, b) => naturalCompare(a.id, b.id))
}
