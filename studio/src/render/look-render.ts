// render's view "3d" in Node: the same scene the Studio's 3D view draws (the board as made with its parts as lit simple
// shapes), drawn by the same code at twice the size and averaged down, from one of four angles, into a PNG.
import type { Design } from "../../../src/engine/design.js"
import { lookWords, resolveLook, type LookRequest } from "../../../src/engine/fab/picture/looks.js"
import { designName } from "../../../src/engine/fab/names.js"
import { naturalCompare } from "../../../src/engine/order.js"
import { solidModel } from "../../../src/engine/solid/model.js"
import { BOTTOM, START, TOP, type Orbit } from "../look/orbit.js"
import { partFaces } from "../look/parts/index.js"
import { renderSmooth } from "../look/raster.js"
import { buildScene } from "../look/scene.js"
import { boardTextures } from "../look/texture.js"

export type Angle = "top" | "bottom" | "front" | "iso"

/** A picture has no buttons beside it: the board fills more of it than the Studio's starting view. */
const FILL = 1.3
export const ANGLES: Record<Angle, Orbit> = { top: { ...TOP, zoom: FILL }, bottom: { ...BOTTOM, zoom: FILL }, front: { yaw: 0, pitch: 18, zoom: FILL }, iso: { ...START, zoom: FILL } }
export const LOOK_MIN_WIDTH = 320
export const LOOK_MAX_WIDTH = 2000
const DEFAULT_WIDTH = 1024
/** The picture's height for its width. */
const ASPECT = 0.68
/** A grey a little lighter than the PCB view's, so dark masks and black parts still stand out. */
export const LOOK_BACKGROUND = [52, 55, 60] as const

export interface LookRequestOptions {
  angle?: Angle
  look?: LookRequest
  width?: number
}

const NAMED = 4

/** "heights typical: R1, U1; none assumed", or "heights 40 typical; none assumed". */
function heightWords(model: ReturnType<typeof solidModel>): string {
  const names = (state: string) => model.parts.filter((p) => p.state === state).map((p) => p.name).sort(naturalCompare)
  const [typical, assumed] = [names("typical"), names("assumed")]
  // A few are named; more are counted, to keep the line short.
  const part = (list: string[], word: string) => (list.length === 0 ? `none ${word}` : list.length <= NAMED ? `${word}: ${list.join(", ")}` : `${list.length} ${word}`)
  return `heights ${part(typical, "typical")}; ${part(assumed, "assumed")}`
}

/** The 3D picture as RGBA pixels and its line, before encoding. */
export function lookPicture(design: Design, request: LookRequestOptions) {
  const width = request.width ?? DEFAULT_WIDTH
  if (!Number.isInteger(width) || width < LOOK_MIN_WIDTH || width > LOOK_MAX_WIDTH) throw new Error(`width must be a whole number of pixels from ${LOOK_MIN_WIDTH} to ${LOOK_MAX_WIDTH} for view 3d`)
  const height = Math.round(width * ASPECT)
  const angle = request.angle ?? "iso"
  const look = request.look ?? {}
  const resolved = resolveLook(look)
  const model = solidModel(design)
  const textures = boardTextures(design, model, look)
  const scene = buildScene(model, { parts: partFaces(design, model), textures, look, mounting: design.pcb.holes.length, layers: design.pcb.board?.layers ?? 2 })
  const frame = renderSmooth(scene, ANGLES[angle], width, height, { background: [...LOOK_BACKGROUND], lit: true })
  const what = `3D from ${angle}, the board as made (${lookWords(resolved)}) and ${model.parts.length} parts as simple shapes, not their real models; ${heightWords(model)}`
  return { rgba: frame.color, width, height, what, label: designName(design.file) }
}

export async function renderLook(design: Design, request: LookRequestOptions) {
  const picture = lookPicture(design, request)
  const { createCanvas } = await import("@napi-rs/canvas")
  const canvas = createCanvas(picture.width, picture.height)
  const ctx = canvas.getContext("2d")
  const image = ctx.createImageData(picture.width, picture.height)
  image.data.set(picture.rgba)
  ctx.putImageData(image, 0, 0)
  const png = await canvas.encode("png")
  return { png: new Uint8Array(png), width: picture.width, height: picture.height, what: picture.what, label: picture.label }
}
