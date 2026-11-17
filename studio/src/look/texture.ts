// The board's two faces as the 3D view paints them: the picture of each side as made (src/engine/fab/picture), with
// a soft shadow of each part painted in where the key light (light.ts) throws it. Made once per design and look and
// kept: turning or zooming the view never makes a new one (textureStore). Pure; the Studio runs it off the page's
// thread (texture-worker.ts).
import type { Design } from "../../../src/engine/design.js"
import { boardPicture, outlineBox, type BoardPicture, type Side } from "../../../src/engine/fab/picture/board-picture.js"
import type { LookRequest } from "../../../src/engine/fab/picture/looks.js"
import type { PartSolid, SolidModel } from "../../../src/engine/solid/model.js"
import { KEY_LIGHT } from "./light.js"

export interface BoardTexture {
  rgba: Uint8ClampedArray
  width: number
  height: number
  /** The pixel (fractional) where the board's 0, 0 lies. */
  origin: { x: number; y: number }
  pxPerMm: number
  /** True for the bottom: board x grows to the left. */
  mirrored: boolean
}

export interface BoardTextures {
  top?: BoardTexture
  bottom?: BoardTexture
}

export type Picturer = (design: Parameters<typeof boardPicture>[0], options: Parameters<typeof boardPicture>[1]) => BoardPicture

/** Finest scale: sharp with a few parts filling the view. */
export const MOST_PX_PER_MM = 40
/** At most this many pixels a side, and this many in all, so a large board stays within memory. */
const LONGEST = 4000
const MOST_PIXELS = 4_000_000

/** The scale the board's picture is made at: 40 px/mm, less for a board too large for that. */
export function texturePxPerMm(box: { minX: number; minY: number; maxX: number; maxY: number }): number {
  const [w, h] = [box.maxX - box.minX, box.maxY - box.minY]
  return Math.min(MOST_PX_PER_MM, LONGEST / Math.max(w, h, 1e-9), Math.sqrt(MOST_PIXELS / Math.max(w * h, 1e-9)))
}

/** Each cell of the shadow grid covers this many pixels a side. */
const CELL = 4
/** How dark a full shadow makes the board. */
const DARKNESS = 0.45
/** A tall part's shadow is drawn as if it were at most this tall: a contact shadow, not a sunset. */
const SHADOW_HEIGHT = 2.6
/** The shadow's softness, in mm. */
const SOFT = 0.45

/** The convex hull of a few points, counter-clockwise. */
function hull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const half = (list: typeof sorted) => {
    const out: typeof sorted = []
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

function boxBlur(data: Float32Array, w: number, h: number, radius: number): Float32Array {
  const pass = (src: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(src.length)
    const [outer, inner] = horizontal ? [h, w] : [w, h]
    for (let a = 0; a < outer; a++) {
      let sum = 0
      const at = (b: number) => (horizontal ? a * w + b : b * w + a)
      for (let b = -radius; b <= radius; b++) sum += b >= 0 && b < inner ? (src[at(b)] as number) : 0
      for (let b = 0; b < inner; b++) {
        out[at(b)] = sum / (2 * radius + 1)
        const [enter, leave] = [b + radius + 1, b - radius]
        if (enter < inner) sum += src[at(enter)] as number
        if (leave >= 0) sum -= src[at(leave)] as number
      }
    }
    return out
  }
  let result = data
  for (let i = 0; i < 2; i++) result = pass(pass(result, true), false)
  return result
}

/** The picture's pixels with each part of its side's soft shadow painted in. A new array. */
export function withShadows(picture: BoardTexture, parts: readonly PartSolid[], side: Side): Uint8ClampedArray {
  const [gw, gh] = [Math.ceil(picture.width / CELL), Math.ceil(picture.height / CELL)]
  const grid = new Float32Array(gw * gh)
  const toCell = (x: number, y: number) => ({ x: (picture.origin.x + (picture.mirrored ? -x : x) * picture.pxPerMm) / CELL, y: (picture.origin.y - y * picture.pxPerMm) / CELL })
  const [dx, dy] = [-KEY_LIGHT[0] / KEY_LIGHT[2], -KEY_LIGHT[1] / KEY_LIGHT[2]]
  for (const part of parts.filter((p) => p.side === side)) {
    const reach = Math.min(part.height, SHADOW_HEIGHT)
    const corners = part.corners.flatMap((c) => [c, { x: c.x + dx * reach, y: c.y + dy * reach }])
    const shape = hull(corners.map((c) => toCell(c.x, c.y)))
    const [x0, x1] = [Math.max(0, Math.floor(Math.min(...shape.map((p) => p.x)))), Math.min(gw - 1, Math.ceil(Math.max(...shape.map((p) => p.x))))]
    const [y0, y1] = [Math.max(0, Math.floor(Math.min(...shape.map((p) => p.y)))), Math.min(gh - 1, Math.ceil(Math.max(...shape.map((p) => p.y))))]
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const [px, py] = [x + 0.5, y + 0.5]
        // Inside a convex polygon: on the same side of every edge (the picture's y runs down, so the hull turns clockwise here).
        let sign = 0
        let inside = true
        for (let i = 0; i < shape.length && inside; i++) {
          const a = shape[i]!
          const b = shape[(i + 1) % shape.length]!
          const s = Math.sign((b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x))
          if (s !== 0) {
            if (sign === 0) sign = s
            else if (s !== sign) inside = false
          }
        }
        if (inside) grid[y * gw + x] = 1
      }
    }
  }
  const soft = boxBlur(grid, gw, gh, Math.max(1, Math.round((SOFT * picture.pxPerMm) / CELL / 2)))
  const out = new Uint8ClampedArray(picture.rgba)
  for (let y = 0; y < picture.height; y++) {
    const gy = Math.min(gh - 1.001, Math.max(0, y / CELL - 0.5))
    const [y0, fy] = [Math.floor(gy), gy - Math.floor(gy)]
    for (let x = 0; x < picture.width; x++) {
      const i = (y * picture.width + x) * 4
      if ((out[i + 3] as number) === 0) continue
      const gx = Math.min(gw - 1.001, Math.max(0, x / CELL - 0.5))
      const [x0, fx] = [Math.floor(gx), gx - Math.floor(gx)]
      const at = (cx: number, cy: number) => soft[Math.min(gh - 1, cy) * gw + Math.min(gw - 1, cx)] as number
      const s = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
      if (s <= 0.002) continue
      const keep = 1 - DARKNESS * Math.min(1, s)
      out[i] = (out[i] as number) * keep
      out[i + 1] = (out[i + 1] as number) * keep
      out[i + 2] = (out[i + 2] as number) * keep
    }
  }
  return out
}

/** Both faces of the board, with the parts' shadows; none for a board without an outline. */
export function boardTextures(design: Design, model: SolidModel, look: LookRequest, picturer: Picturer = boardPicture): BoardTextures {
  let box
  try {
    box = outlineBox(design.pcb)
  } catch {
    return {}
  }
  const pxPerMm = texturePxPerMm(box)
  const side = (which: Side): BoardTexture => {
    const picture = picturer(design, { side: which, look: { ...look, background: undefined } as LookRequest, pxPerMm })
    const texture: BoardTexture = { rgba: picture.rgba, width: picture.width, height: picture.height, origin: picture.origin, pxPerMm: picture.pxPerMm, mirrored: picture.mirrored }
    return { ...texture, rgba: withShadows(texture, model.parts, which) }
  }
  return { top: side("top"), bottom: side("bottom") }
}

/** The same look by its words: two requests with the same choices are the same look. */
export const lookKey = (look: LookRequest): string => `${look.mask ?? ""}/${look.silk ?? ""}/${look.finish ?? ""}`

/** Keeps the last design's textures for its look; a new picture only when the design or the look changes. */
export function textureStore(picturer: Picturer = boardPicture) {
  let kept: { design: Design; key: string; textures: BoardTextures } | undefined
  return {
    get(design: Design, model: SolidModel, look: LookRequest): BoardTextures {
      const key = lookKey(look)
      if (kept && kept.design === design && kept.key === key) return kept.textures
      kept = { design, key, textures: boardTextures(design, model, look, picturer) }
      return kept.textures
    },
  }
}
