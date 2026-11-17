// The picture put together from one side's coverage images, bottom to top: the laminate, the mask with the copper under
// it, the bare copper's finish in the mask's openings, the print, the holes and the cut edge. Each step is a pure
// function of the images and of the step before it, on plain arrays: red, green and blue (0 to 255) per pixel, then
// alpha. A soft copy of a layer (a short blur) stands for its height: copper under the mask is a raised ridge, lit from
// the top left, and a pad's finish is darker where it runs down the copper's edge.
import type { Coverage } from "./raster.js"
import { BARREL, FINISHES, LAMINATE, MASKS, SILKS, type Look, type Rgb } from "./looks.js"

/** One side's layers, each drawn by itself (layer-images.ts), all on the same grid. */
export interface SideImages {
  /** The board's body, from the outline. */
  body: Coverage
  /** This side's copper. */
  copper: Coverage
  /** Copper on every other layer: where any lies, no light comes through the laminate. */
  otherCopper: Coverage
  /** The solder mask's openings on this side. */
  openings: Coverage
  /** This side's print. */
  silk: Coverage
  /** Plated holes at their drilled size. */
  plated: Coverage
  /** Plated holes less their wall: what one sees through. */
  bore: Coverage
  /** Holes drilled without plating. */
  nonPlated: Coverage
}

/** The share of copper's relief and of the edge's shading, in mm: how far a soft edge reaches. */
const MASK_SOFTNESS = 0.06
const FINISH_SOFTNESS = 0.035
const EDGE_SOFTNESS = 0.08
/** How bright the light from the top left makes a raised edge, in colour steps. */
const RELIEF_LIGHT = 34
/** The mask's broad sheen across the board, in colour steps at full gloss. */
const SHEEN = 14
/** How dark the cut rim of the board and of each hole gets, 0 to 1. */
const RIM_DARK = 0.42
/** The print's ink covers all but a trace of what is under it. */
const INK_COVER = 0.97

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const at = (image: Coverage, i: number) => image.data[i] as number
const radiusOf = (mm: number, pxPerMm: number) => Math.max(1, Math.round(mm * pxPerMm))

/** One pass of a box blur `r` pixels each way along rows (`step` 1) or columns (`step` width), edges held. */
function boxPass(source: Float32Array, width: number, height: number, r: number, alongRows: boolean): Float32Array {
  const out = new Float32Array(source.length)
  const [lines, length] = alongRows ? [height, width] : [width, height]
  const step = alongRows ? 1 : width
  const scale = 1 / (2 * r + 1)
  for (let line = 0; line < lines; line += 1) {
    const start = alongRows ? line * width : line
    const last = start + (length - 1) * step
    let sum = 0
    for (let k = -r; k <= r; k += 1) sum += source[start + Math.min(Math.max(k, 0), length - 1) * step] as number
    for (let k = 0, at = start; k < length; k += 1, at += step) {
      out[at] = sum * scale
      const enter = k + r + 1 < length ? at + (r + 1) * step : last
      const leave = k - r > 0 ? at - r * step : start
      sum += (source[enter] as number) - (source[leave] as number)
    }
  }
  return out
}

/** A soft copy of the layer: a box blur of `r` pixels, twice, so its edge rises smoothly. */
export function soften(image: Coverage, r: number): Coverage {
  let data = image.data
  for (let pass = 0; pass < 2; pass += 1) data = boxPass(boxPass(data, image.width, image.height, r, true), image.width, image.height, r, false)
  return { width: image.width, height: image.height, data }
}

/** How a soft layer slopes toward the light at the top left: positive on its lit edges, negative on its shaded ones. */
export function slope(soft: Coverage, r: number): Float32Array {
  const { width, height } = soft
  const out = new Float32Array(width * height)
  const d = Math.max(1, Math.round(r / 2))
  const gain = (r + 1) / (2 * d)
  for (let y = 0; y < height; y += 1) {
    const [up, down] = [Math.max(y - d, 0), Math.min(y + d, height - 1)]
    for (let x = 0; x < width; x += 1) {
      const [left, right] = [Math.max(x - d, 0), Math.min(x + d, width - 1)]
      out[y * width + x] = Math.max(-1, Math.min(1, ((soft.data[down * width + right] as number) - (soft.data[up * width + left] as number)) * -gain))
    }
  }
  return out
}

function mixInto(out: Float32Array, i: number, below: Float32Array, j: number, colour: readonly number[], share: number): void {
  for (let c = 0; c < 3; c += 1) out[i + c] = (below[j + c] as number) + ((colour[c] as number) - (below[j + c] as number)) * share
}

/** The laminate: lit where neither this side nor any other has copper (light comes through), shaded elsewhere. */
export function bodyStep(images: SideImages): Float32Array {
  const n = images.body.data.length
  const rgb = new Float32Array(n * 3)
  const shaded = LAMINATE.shaded
  const rise = [0, 1, 2].map((c) => (LAMINATE.lit[c] as number) - (shaded[c] as number)) as unknown as Rgb
  for (let i = 0; i < n; i += 1) {
    const lit = (1 - at(images.copper, i)) * (1 - at(images.otherCopper, i))
    rgb[i * 3] = shaded[0] + rise[0] * lit
    rgb[i * 3 + 1] = shaded[1] + rise[1] * lit
    rgb[i * 3 + 2] = shaded[2] + rise[2] * lit
  }
  return rgb
}

/**
 * The mask over everything but its openings: its colour over laminate, lighter where copper lies under it with a soft
 * edge (`relief`, the copper softened) lit from the top left, a trace of the laminate's light, and a broad sheen.
 */
export function maskStep(below: Float32Array, images: SideImages, look: Look, relief: { soft: Coverage; slope: Float32Array }): Float32Array {
  const mask = MASKS[look.mask]
  const { width, height } = images.body
  const out = new Float32Array(below.length)
  const tint = [0, 0, 0]
  for (let y = 0; y < height; y += 1) {
    const sheen = mask.gloss * SHEEN * 0.5
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const covered = at(images.body, i) * (1 - at(images.openings, i))
      const raised = at(relief.soft, i)
      const light = (relief.slope[i] as number) * RELIEF_LIGHT * (0.5 + mask.gloss * 0.5)
      const broad = sheen * (1 - x / width - y / height)
      for (let c = 0; c < 3; c += 1) {
        const base = (mask.over[c] as number) + ((mask.onCopper[c] as number) - (mask.over[c] as number)) * raised
        tint[c] = base + ((below[i * 3 + c] as number) - (LAMINATE.shaded[c] as number)) * mask.see + light + broad
      }
      mixInto(out, i * 3, below, i * 3, tint, covered)
    }
  }
  return out
}

/** Bare copper in the openings: the finish's face, darker toward its rim (`relief`, the bare copper softened), with a glint. */
export function finishStep(below: Float32Array, images: SideImages, look: Look, relief: { soft: Coverage; slope: Float32Array }): Float32Array {
  const finish = FINISHES[look.finish]
  const out = new Float32Array(below)
  const colour = [0, 0, 0]
  for (let i = 0; i < images.body.data.length; i += 1) {
    const bare = at(images.copper, i) * at(images.openings, i) * at(images.body, i)
    if (bare <= 0) continue
    const inner = smooth(0.1, 0.9, at(relief.soft, i))
    const glint = relief.slope[i] as number
    for (let c = 0; c < 3; c += 1) {
      const face = (finish.rim[c] as number) + ((finish.face[c] as number) - (finish.rim[c] as number)) * inner
      colour[c] = glint >= 0 ? face + ((finish.shine[c] as number) - face) * glint * 0.8 : face + ((finish.rim[c] as number) - face) * -glint * 0.6
    }
    mixInto(out, i * 3, below, i * 3, colour, bare)
  }
  return out
}

/** The print, only where the mask is under it: on a pad or over a hole it is not made. */
export function silkStep(below: Float32Array, images: SideImages, look: Look): Float32Array {
  const ink = SILKS[look.silk].colour
  const out = new Float32Array(below)
  for (let i = 0; i < images.body.data.length; i += 1) {
    const printed = at(images.silk, i) * at(images.body, i) * (1 - at(images.openings, i)) * (1 - Math.max(at(images.plated, i), at(images.nonPlated, i)))
    if (printed > 0) mixInto(out, i * 3, below, i * 3, ink, printed * INK_COVER)
  }
  return out
}

/** What one sees through: the bore of each plated hole and every unplated one. */
const through = (images: SideImages, i: number) => Math.max(at(images.bore, i), at(images.nonPlated, i))

/** The holes: through the board (alpha 0), each plated one inside a dark barrel. Red, green, blue and alpha. */
export function holesStep(below: Float32Array, images: SideImages): Float32Array {
  const n = images.body.data.length
  const out = new Float32Array(n * 4)
  for (let i = 0; i < n; i += 1) {
    const wall = Math.max(0, at(images.plated, i) - at(images.bore, i))
    if (wall > 0) mixInto(out, i * 4, below, i * 3, BARREL, wall)
    else {
      out[i * 4] = below[i * 3] as number
      out[i * 4 + 1] = below[i * 3 + 1] as number
      out[i * 4 + 2] = below[i * 3 + 2] as number
    }
    out[i * 4 + 3] = at(images.body, i) * (1 - through(images, i))
  }
  return out
}

/** The edge: a thin darker line where the board and its holes are cut, from the solid board softened. */
export function edgeStep(below: Float32Array, solidSoft: Coverage): Float32Array {
  const out = new Float32Array(below)
  for (let i = 0; i < solidSoft.data.length; i += 1) {
    const rim = clamp01((1 - at(solidSoft, i)) * 2.5)
    if (rim <= 0) continue
    for (let c = 0; c < 3; c += 1) out[i * 4 + c] = (below[i * 4 + c] as number) * (1 - RIM_DARK * rim)
  }
  return out
}

/** The pixels, 0 to 255, over the background when one is asked for. */
export function finished(rgba: Float32Array, background: Rgb | undefined): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3] as number
    if (background === undefined) {
      for (let c = 0; c < 3; c += 1) out[i + c] = rgba[i + c] as number
      out[i + 3] = alpha * 255
      continue
    }
    for (let c = 0; c < 3; c += 1) out[i + c] = (background[c] as number) + ((rgba[i + c] as number) - (background[c] as number)) * alpha
    out[i + 3] = 255
  }
  return out
}

/** The whole picture of one side, in the order above; `pxPerMm` sets how far the soft edges reach. */
export function compose(images: SideImages, look: Look, pxPerMm: number): Uint8ClampedArray {
  const relief = (image: Coverage, mm: number) => {
    const r = radiusOf(mm, pxPerMm)
    const soft = soften(image, r)
    return { soft, slope: slope(soft, r) }
  }
  const n = images.body.data.length
  const bare: Coverage = { ...images.copper, data: new Float32Array(n) }
  const solid: Coverage = { ...images.body, data: new Float32Array(n) }
  for (let i = 0; i < n; i += 1) {
    bare.data[i] = at(images.copper, i) * at(images.openings, i)
    solid.data[i] = at(images.body, i) * (1 - through(images, i))
  }
  const body = bodyStep(images)
  const masked = maskStep(body, images, look, relief(images.copper, MASK_SOFTNESS))
  const plated = finishStep(masked, images, look, relief(bare, FINISH_SOFTNESS))
  const printed = silkStep(plated, images, look)
  const holed = holesStep(printed, images)
  const edged = edgeStep(holed, soften(solid, radiusOf(EDGE_SOFTNESS, pxPerMm)))
  return finished(edged, look.background)
}
