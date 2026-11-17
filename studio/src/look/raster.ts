// Draws the 3D view's scene into pixels with a depth buffer, written here without a library. Every opaque face is
// filled row by row (its holes left empty, by the even-odd rule) and a pixel is kept only where the face is nearer
// than what is already there, so what is in front always hides what is behind, whatever the order of the faces and
// even where boxes overlap in ways no back-to-front order can draw. The see-through board is drawn after them: it
// tints only what lies behind it and never hides it. Each pixel also keeps the part it shows, for hover. Pure.
import { keyFor, lightFace } from "./light.js"
import { dot, viewFrame, type Orbit, type ViewFrame } from "./orbit.js"
import type { Face, Rgb, Scene, Vec3 } from "./scene.js"

export interface Frame {
  width: number
  height: number
  /** RGBA, row by row from the top left, as canvas ImageData holds it. */
  color: Uint8ClampedArray
  /** The part each pixel shows, -1 where none does. */
  ids: Int32Array
  depth: Float32Array
  /** The face each pixel shows (its index in the scene), -1 where none does: for the darker edges. */
  faces: Int32Array
}

export interface RenderOptions {
  background: Rgb
  /** A part drawn lighter: the one under the pointer or focused in the list. */
  highlight?: number
  /** Buffers to draw into again when the size is the same. */
  reuse?: Frame
  /** Lit by the key light, fill and ambient (light.ts), the board opaque and painted, edges a little darker. */
  lit?: boolean
  /** Blend the board's picture between pixels (at rest); nearest pixel when false (while moving). */
  fine?: boolean
}

/** The light: a face turned squarely to the eye is at full colour, one seen edge-on at this share. */
const AMBIENT = 0.35
/** How far a highlighted part's colour moves towards white. */
const HIGHLIGHT = 0.45
/** A face more edge-on than this is not filled: it covers no area. */
const EDGE_ON = 1e-6

function frameOf(width: number, height: number, reuse: Frame | undefined): Frame {
  if (reuse && reuse.width === width && reuse.height === height) return reuse
  const size = width * height
  return { width, height, color: new Uint8ClampedArray(size * 4), ids: new Int32Array(size), depth: new Float32Array(size), faces: new Int32Array(size) }
}

interface Projected {
  /** Each loop's corners on screen. */
  loops: { x: number; y: number }[][]
  /** depth = a·x + b·y + c over the face's plane. */
  a: number
  b: number
  c: number
}

/** The face on screen with its plane's depth as a function of the pixel; undefined when it is seen edge-on. */
function projectFace(face: Face, view: ViewFrame): Projected | undefined {
  const facing = dot(face.normal, view.eye)
  if (Math.abs(facing) < EDGE_ON) return undefined
  const first = face.loops[0]?.[0]
  if (first === undefined) return undefined
  // A point of the face: p = target + X·right + Y·up − depth·eye, with X = (x − w/2)/s and Y = (h/2 − y)/s. On the
  // face's plane n·p = n·first, so depth = (n·target + X n·right + Y n·up − n·first) / n·eye.
  const [nr, nu] = [dot(face.normal, view.right), dot(face.normal, view.up)]
  const offset = dot(face.normal, view.target) - dot(face.normal, first)
  const a = nr / view.scale / facing
  const b = -nu / view.scale / facing
  const c = (offset - (nr * view.width) / 2 / view.scale + (nu * view.height) / 2 / view.scale) / facing
  const loops = face.loops.map((loop) =>
    loop.map((p: Vec3) => {
      const d: Vec3 = [p[0] - view.target[0], p[1] - view.target[1], p[2] - view.target[2]]
      return { x: view.width / 2 + view.scale * dot(d, view.right), y: view.height / 2 - view.scale * dot(d, view.up) }
    }),
  )
  return { loops, a, b, c }
}

/** Calls `fill(x, y, depth)` for every pixel whose centre is inside the face (holes left out). */
function scan(face: Projected, width: number, height: number, fill: (index: number, depth: number) => void): void {
  let [top, bottom] = [Infinity, -Infinity]
  for (const loop of face.loops) for (const p of loop) [top, bottom] = [Math.min(top, p.y), Math.max(bottom, p.y)]
  const first = Math.max(0, Math.ceil(top - 0.5))
  const last = Math.min(height - 1, Math.floor(bottom - 0.5))
  const crossings: number[] = []
  for (let row = first; row <= last; row++) {
    const y = row + 0.5
    crossings.length = 0
    for (const loop of face.loops) {
      for (let i = 0; i < loop.length; i++) {
        const p = loop[i] as { x: number; y: number }
        const q = loop[(i + 1) % loop.length] as { x: number; y: number }
        if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y)) crossings.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x))
      }
    }
    crossings.sort((m, n) => m - n)
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil((crossings[k] as number) - 0.5))
      const to = Math.min(width - 1, Math.floor((crossings[k + 1] as number) - 0.5))
      for (let col = from; col <= to; col++) fill(row * width + col, face.a * (col + 0.5) + face.b * y + face.c)
    }
  }
}

/** The face's colour lit by how squarely it faces the eye, lighter when its part is highlighted. */
function shade(face: Face, view: ViewFrame, highlight: number | undefined): Rgb {
  const light = AMBIENT + (1 - AMBIENT) * Math.abs(dot(face.normal, view.eye))
  const lift = face.part >= 0 && face.part === highlight ? HIGHLIGHT : 0
  return face.color.map((channel) => Math.round(channel * light + (255 - channel * light) * lift)) as unknown as Rgb
}

/** Draws the scene from `orbit` into a width × height frame. */
export function renderScene(scene: Scene, orbit: Orbit, width: number, height: number, options: RenderOptions): Frame {
  const frame = frameOf(width, height, options.reuse)
  const view = viewFrame(orbit, scene, width, height)
  const [br, bg, bb] = options.background
  for (let i = 0; i < width * height; i++) {
    frame.color[i * 4] = br
    frame.color[i * 4 + 1] = bg
    frame.color[i * 4 + 2] = bb
    frame.color[i * 4 + 3] = 255
  }
  frame.ids.fill(-1)
  frame.depth.fill(Infinity)
  frame.faces.fill(-1)
  if (options.lit) {
    drawLit(scene, view, frame, options)
    return frame
  }
  const opaque = scene.faces.filter((face) => face.alpha >= 1)
  const clear = scene.faces.filter((face) => face.alpha < 1)
  for (const face of opaque) {
    const projected = projectFace(face, view)
    if (!projected) continue
    const [r, g, b] = shade(face, view, options.highlight)
    scan(projected, width, height, (index, depth) => {
      if (depth >= (frame.depth[index] as number)) return
      frame.depth[index] = depth
      frame.ids[index] = face.part
      frame.color[index * 4] = r
      frame.color[index * 4 + 1] = g
      frame.color[index * 4 + 2] = b
    })
  }
  for (const face of clear) {
    const projected = projectFace(face, view)
    if (!projected) continue
    const [r, g, b] = shade(face, view, undefined)
    const keep = 1 - face.alpha
    scan(projected, width, height, (index, depth) => {
      if (depth >= (frame.depth[index] as number)) return
      frame.color[index * 4] = (frame.color[index * 4] as number) * keep + r * face.alpha
      frame.color[index * 4 + 1] = (frame.color[index * 4 + 1] as number) * keep + g * face.alpha
      frame.color[index * 4 + 2] = (frame.color[index * 4 + 2] as number) * keep + b * face.alpha
    })
  }
  return frame
}

/** Darker where a pixel's face meets another at a fold, a step in depth or another part: the edges a person reads shape by. */
const EDGE_DARK = 0.78
/** Faces closer in angle than this (cos) are one smooth surface: the pieces of a cylinder, a hole's wall. */
const SMOOTH = 0.94

/** The lit drawing: every face opaque, painted or in its colour, lit by its angle to the key light and the eye. */
function drawLit(scene: Scene, view: ViewFrame, frame: Frame, options: RenderOptions): void {
  const key = keyFor(view.eye)
  const sample = new Float32Array(3)
  const { width, height } = frame
  scene.faces.forEach((face, index) => {
    const projected = projectFace(face, view)
    if (!projected) return
    const { scale, add } = lightFace(face.normal, view.eye, key, face.material)
    const lift = face.part >= 0 && face.part === options.highlight ? HIGHLIGHT : 0
    const tone = (c: number) => Math.min(255, c * scale + add) * (1 - lift) + 255 * lift
    const paint = face.paint
    if (!paint) {
      const [r, g, b] = [tone(face.color[0]), tone(face.color[1]), tone(face.color[2])]
      scan(projected, width, height, (i, depth) => {
        if (depth >= (frame.depth[i] as number)) return
        frame.depth[i] = depth
        frame.ids[i] = face.part
        frame.faces[i] = index
        frame.color[i * 4] = r
        frame.color[i * 4 + 1] = g
        frame.color[i * 4 + 2] = b
      })
      return
    }
    // The board point at a pixel: target + X·right + Y·up − depth·eye, X and Y from the pixel's centre.
    const s = view.scale
    const fine = options.fine ?? false
    scan(projected, width, height, (i, depth) => {
      if (depth >= (frame.depth[i] as number)) return
      const col = (i % width) + 0.5
      const row = Math.floor(i / width) + 0.5
      const X = (col - width / 2) / s
      const Y = (height / 2 - row) / s
      const x = view.target[0] + X * view.right[0] + Y * view.up[0] - depth * view.eye[0]
      const y = view.target[1] + X * view.right[1] + Y * view.up[1] - depth * view.eye[1]
      const z = view.target[2] + X * view.right[2] + Y * view.up[2] - depth * view.eye[2]
      if (paint.at(x, y, z, sample, fine) < 0.5) return
      frame.depth[i] = depth
      frame.ids[i] = face.part
      frame.faces[i] = index
      frame.color[i * 4] = tone(sample[0] as number)
      frame.color[i * 4 + 1] = tone(sample[1] as number)
      frame.color[i * 4 + 2] = tone(sample[2] as number)
    })
  })
  darkenEdges(scene, frame, view.scale)
}

function darkenEdges(scene: Scene, frame: Frame, scale: number): void {
  const { width, height, faces, depth, color } = frame
  const step = 2 / scale
  const edge = new Uint8Array(width * height)
  const differ = (a: number, b: number) => {
    const [fa, fb] = [faces[a] as number, faces[b] as number]
    if (fa === fb) return false
    if (fa < 0 || fb < 0) return fa !== fb && (fa >= 0 || fb >= 0)
    const [A, B] = [scene.faces[fa] as Face, scene.faces[fb] as Face]
    if (A.part !== B.part) return true
    if (Math.abs((depth[a] as number) - (depth[b] as number)) > step) return true
    return dot(A.normal, B.normal) < SMOOTH
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (x + 1 < width && differ(i, i + 1)) edge[(depth[i] as number) > (depth[i + 1] as number) ? i + 1 : i] = 1
      if (y + 1 < height && differ(i, i + width)) edge[(depth[i] as number) > (depth[i + width] as number) ? i + width : i] = 1
    }
  }
  for (let i = 0; i < edge.length; i++) {
    if (!edge[i] || (faces[i] as number) < 0) continue
    color[i * 4] = (color[i * 4] as number) * EDGE_DARK
    color[i * 4 + 1] = (color[i * 4 + 1] as number) * EDGE_DARK
    color[i * 4 + 2] = (color[i * 4 + 2] as number) * EDGE_DARK
  }
}

/** The scene drawn `factor` times finer and averaged down: smooth edges for a view at rest and for a picture. */
export function renderSmooth(scene: Scene, orbit: Orbit, width: number, height: number, options: RenderOptions, factor = 2): Frame {
  const big = renderScene(scene, orbit, width * factor, height * factor, { ...options, reuse: undefined, fine: true })
  const frame = frameOf(width, height, options.reuse)
  const n = factor * factor
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let [r, g, b] = [0, 0, 0]
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const k = ((y * factor + dy) * big.width + x * factor + dx) * 4
          r += big.color[k] as number
          g += big.color[k + 1] as number
          b += big.color[k + 2] as number
        }
      }
      const i = y * width + x
      const centre = (y * factor + (factor >> 1)) * big.width + x * factor + (factor >> 1)
      frame.color[i * 4] = r / n
      frame.color[i * 4 + 1] = g / n
      frame.color[i * 4 + 2] = b / n
      frame.color[i * 4 + 3] = 255
      frame.ids[i] = big.ids[centre] as number
      frame.depth[i] = big.depth[centre] as number
      frame.faces[i] = big.faces[centre] as number
    }
  }
  return frame
}
