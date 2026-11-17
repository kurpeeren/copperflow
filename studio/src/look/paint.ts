// The paints of the board's faces: its picture laid on the top and the bottom (nearest pixel while the view moves,
// blended between the four nearest when it rests), and its edge: the laminate with a thin copper line at each copper
// layer. Pure.
import { BARREL, LAMINATE, MASKS, resolveLook, type LookRequest } from "../../../src/engine/fab/picture/looks.js"
import type { Paint, Rgb } from "./scene.js"
import type { BoardTexture } from "./texture.js"

/** The board's picture as a paint: alpha 0 off the board and through its holes. */
export function texturePaint(texture: BoardTexture): Paint {
  const { rgba, width, height, origin, pxPerMm, mirrored } = texture
  const sign = mirrored ? -1 : 1
  return {
    at(x, y, _z, out, fine) {
      const u = origin.x + sign * x * pxPerMm
      const v = origin.y - y * pxPerMm
      if (!fine) {
        const [i, j] = [Math.floor(u), Math.floor(v)]
        if (i < 0 || j < 0 || i >= width || j >= height) return 0
        const k = (j * width + i) * 4
        out[0] = rgba[k] as number
        out[1] = rgba[k + 1] as number
        out[2] = rgba[k + 2] as number
        return (rgba[k + 3] as number) / 255
      }
      const [fu, fv] = [u - 0.5, v - 0.5]
      const [i, j] = [Math.floor(fu), Math.floor(fv)]
      const [a, b] = [fu - i, fv - j]
      let alpha = 0
      out[0] = out[1] = out[2] = 0
      for (const [di, dj, w] of [[0, 0, (1 - a) * (1 - b)], [1, 0, a * (1 - b)], [0, 1, (1 - a) * b], [1, 1, a * b]] as const) {
        const [ii, jj] = [Math.min(width - 1, Math.max(0, i + di)), Math.min(height - 1, Math.max(0, j + dj))]
        const k = (jj * width + ii) * 4
        const wa = (w * (rgba[k + 3] as number)) / 255
        out[0] += (rgba[k] as number) * wa
        out[1] += (rgba[k + 1] as number) * wa
        out[2] += (rgba[k + 2] as number) * wa
        alpha += wa
      }
      if (alpha > 0) {
        out[0] /= alpha
        out[1] /= alpha
        out[2] /= alpha
      }
      return alpha
    },
  }
}

const COPPER: Rgb = [176, 112, 58]
const COPPER_HALF = 0.0175

/** The board's edge: laminate, with copper lines at z = 0, the thickness, and inner layers spread between. */
export function edgePaint(thickness: number, layers: 2 | 4, mask: Rgb): Paint {
  const lines = layers === 4 ? [0, thickness / 3, (2 * thickness) / 3, thickness] : [0, thickness]
  const laminate = LAMINATE.lit
  return {
    at(_x, _y, z, out) {
      const nearMask = z < 0.02 || z > thickness - 0.02
      const onCopper = lines.some((line) => Math.abs(z - (line === 0 ? COPPER_HALF + 0.01 : line === thickness ? thickness - COPPER_HALF - 0.01 : line)) <= COPPER_HALF)
      const c = nearMask ? mask : onCopper ? COPPER : laminate
      out[0] = c[0]
      out[1] = c[1]
      out[2] = c[2]
      return 1
    },
  }
}

/** The colours of the board before its picture is made: the mask's, the laminate's, the plated wall's. */
export function plainBoardColours(look: LookRequest): { mask: Rgb; laminate: Rgb; barrel: Rgb } {
  const resolved = resolveLook({ ...look, background: undefined } as LookRequest)
  return { mask: MASKS[resolved.mask].over, laminate: LAMINATE.lit, barrel: BARREL }
}
