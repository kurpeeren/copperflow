import { COPPER_LAYERS, type CopperLayer } from "../../core/layout-file.js"
import { copperPieces, padPieces, type ClassOf, type CopperPiece } from "../checks/copper-pieces.js"
import { bounds, drillShape, padShape, type Shape } from "../checks/geometry.js"
import type { Box } from "../checks/grid-index.js"
import type { Point } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PcbLayout, WorldPad } from "../pcb.js"
import { DEFAULT_CLASS } from "../rules/profiles.js"

/**
 * What the router keeps clear of: the copper the copper checks measure (pads, tracks, vias), each with the box around
 * its shapes and its hole. A pad of a shape the checks do not know is kept out over its whole box, so the router never
 * runs through it.
 */
export interface Obstacle extends CopperPiece {
  box: Box
  /** The drilled hole of a through pad or a via. */
  hole?: Shape
}

const DEG = Math.PI / 180

/** The box around the shapes. */
export function boxOf(shapes: readonly Shape[]): Box {
  const boxes = shapes.map(bounds)
  return {
    minX: Math.min(...boxes.map((box) => box.minX)),
    minY: Math.min(...boxes.map((box) => box.minY)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    maxY: Math.max(...boxes.map((box) => box.maxY)),
  }
}

/** A pad's width × height rectangle, turned with it: the most a pad of any shape covers. */
function padBox(pad: WorldPad): Shape {
  const size = (value: number) => (Number.isFinite(value) && value > 0 ? value / 2 : 0)
  const [hw, hh] = [size(pad.width), size(pad.height)]
  const [cos, sin] = [Math.cos(pad.rotation * DEG), Math.sin(pad.rotation * DEG)]
  const corners: Point[] = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ]
  return { core: corners.map((c) => ({ x: pad.x + c.x * cos - c.y * sin, y: pad.y + c.x * sin + c.y * cos })), radius: 0 }
}

const padLayers = (pad: WorldPad): readonly CopperLayer[] => (pad.layers === "through" ? COPPER_LAYERS : [pad.layers])

/** Pads of a shape the checks skip, as their box. */
function unknownPads(layout: PcbLayout, classOf: ClassOf): CopperPiece[] {
  return layout.parts
    .flatMap((part) => part.pads)
    .filter((pad) => padShape(pad) === undefined)
    .map((pad) => ({
      id: pad.id,
      kind: "pad" as const,
      ...(pad.net === undefined ? {} : { net: pad.net }),
      className: pad.net === undefined ? DEFAULT_CLASS.name : classOf(pad.net),
      layers: padLayers(pad),
      shapes: [padBox(pad)],
      at: { x: pad.x, y: pad.y },
    }))
}

/** The pads (known shapes, then the others as boxes) and the layout's copper, with their boxes and holes, in natural id order. */
export function obstaclesOf(layout: PcbLayout, classOf: ClassOf): Obstacle[] {
  const pads = new Map(layout.parts.flatMap((part) => part.pads).map((pad) => [pad.id, pad]))
  const vias = new Map(layout.vias.map((via) => [via.id, via]))
  const holeOf = (piece: CopperPiece): Shape | undefined => {
    if (piece.kind === "via") {
      const via = vias.get(piece.id)
      return via === undefined ? undefined : { core: [via.at], radius: via.drill / 2 }
    }
    const pad = piece.kind === "pad" ? pads.get(piece.id) : undefined
    return pad === undefined || pad.layers !== "through" ? undefined : drillShape(pad)
  }
  const pieces = [...padPieces(layout, classOf), ...unknownPads(layout, classOf), ...copperPieces(layout, classOf)]
  return pieces
    .map((piece) => {
      const hole = holeOf(piece)
      return { ...piece, box: boxOf(piece.shapes), ...(hole === undefined ? {} : { hole }) }
    })
    .sort((a, b) => naturalCompare(a.id, b.id))
}
