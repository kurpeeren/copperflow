// The 3D view's scene as a GLB file (binary glTF 2.0), for a 3D viewer or another program: the board and each part a
// node by name, every face cut into triangles, one material for each colour and kind of surface, and the board's
// pictures and its edge as textures. The scene's millimetres with z up stay as they are in the meshes; one node above
// them turns them into the format's metres with y up. Pure: the PNG encoder is handed in.
import earcut from "earcut"
import type { Face, Material, Paint, Scene, Vec3 } from "./scene.js"

export interface GlbOptions {
  /** The scene's name: the design's. */
  name: string
  /** The parts' names by their number in the scene; a part without one is "part 3". */
  names: readonly string[]
  /** Encodes a picture as a PNG. */
  png(image: { rgba: Uint8ClampedArray; width: number; height: number }): Uint8Array
}

const FLOAT = 5126
const UINT = 5125
const ARRAY_BUFFER = 34962
const ELEMENT_ARRAY_BUFFER = 34963
const LINEAR = 9729
const LINEAR_MIPMAP_LINEAR = 9987
const CLAMP_TO_EDGE = 33071

/** Millimetres with z up to metres with y up, column by column: x stays, y becomes the depth, z the height. */
const TO_METRES_Y_UP = [0.001, 0, 0, 0, 0, 0, -0.001, 0, 0, 0.001, 0, 0, 0, 0, 0, 1]

/** How each kind of surface takes the light. Metal is not full metal: a viewer without surroundings shows that black. */
const SURFACE: Record<Material, { metallicFactor: number; roughnessFactor: number }> = {
  matt: { metallicFactor: 0, roughnessFactor: 0.8 },
  metal: { metallicFactor: 0.75, roughnessFactor: 0.35 },
}
/** The board's faces: the mask has a little shine. */
const BOARD_SURFACE = { metallicFactor: 0, roughnessFactor: 0.55 }

/** The edge's strip: this many pixels up the face (a copper layer is 0.035 mm of 1.6), a few across. */
const STRIP_HEIGHT = 128
const STRIP_WIDTH = 4

const round4 = (value: number) => Math.round(value * 10000) / 10000
/** A colour channel, 0 to 255 as the screen shows it, in linear light, 0 to 1. */
const linear = (channel: number) => {
  const c = channel / 255
  return round4(c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
}

/** A primitive being gathered: the triangles of one material in one mesh. */
interface Gathered {
  material: number
  positions: number[]
  normals: number[]
  uvs: number[] | undefined
  indices: number[]
}

/** Where a painted face's corner lies on its picture, 0 to 1 across and down. */
type Mapping = (point: Vec3) => [number, number]

/** A flat face as triangles: numbers into its corners (outline, then holes), each turning the way the normal points. */
function triangles(face: Face): { corners: Vec3[]; indices: number[] } {
  const corners = face.loops.flat()
  // Seen along the axis the face faces most, a flat face keeps its shape.
  const [nx, ny, nz] = face.normal.map(Math.abs) as [number, number, number]
  const drop = nx >= ny && nx >= nz ? 0 : ny >= nz ? 1 : 2
  const [a, b] = [(drop + 1) % 3, (drop + 2) % 3]
  const flat = corners.flatMap((corner) => [corner[a] as number, corner[b] as number])
  const holes: number[] = []
  face.loops.slice(0, -1).reduce((count, loop) => (holes.push(count + loop.length), count + loop.length), 0)
  const cut = earcut(flat, holes, 2)
  const indices: number[] = []
  for (let i = 0; i < cut.length; i += 3) {
    const [p, q, r] = [cut[i] as number, cut[i + 1] as number, cut[i + 2] as number]
    const [P, Q, R] = [corners[p] as Vec3, corners[q] as Vec3, corners[r] as Vec3]
    const [ux, uy, uz] = [Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]]
    const [vx, vy, vz] = [R[0] - P[0], R[1] - P[1], R[2] - P[2]]
    const along = (uy * vz - uz * vy) * face.normal[0] + (uz * vx - ux * vz) * face.normal[1] + (ux * vy - uy * vx) * face.normal[2]
    if (along === 0) continue
    indices.push(p, ...(along > 0 ? [q, r] : [r, q]))
  }
  return { corners, indices }
}

/** The file's bytes: the JSON chunk padded with spaces, the binary chunk with zeros. */
function pack(json: unknown, bin: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json))
  const jsonLength = Math.ceil(text.length / 4) * 4
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + bin.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, out.length, true)
  view.setUint32(12, jsonLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  out.fill(0x20, 20, 20 + jsonLength)
  out.set(text, 20)
  view.setUint32(20 + jsonLength, bin.length, true)
  view.setUint32(24 + jsonLength, 0x004e4942, true)
  out.set(bin, 28 + jsonLength)
  return out
}

/** The scene as a GLB file's bytes. */
export function sceneGlb(scene: Scene, options: GlbOptions): Uint8Array {
  const chunks: Uint8Array[] = []
  let length = 0
  const bufferViews: { buffer: 0; byteOffset: number; byteLength: number; target?: number }[] = []
  /** Adds bytes to the buffer, padded to four, and answers their view's number. */
  const addView = (bytes: Uint8Array, target?: number): number => {
    bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, ...(target !== undefined ? { target } : {}) })
    const padded = Math.ceil(bytes.length / 4) * 4
    const chunk = new Uint8Array(padded)
    chunk.set(bytes)
    chunks.push(chunk)
    length += padded
    return bufferViews.length - 1
  }
  const bytesOf = (array: Float32Array | Uint32Array) => new Uint8Array(array.buffer, array.byteOffset, array.byteLength)

  // The pictures: one image for each paint, its mapping worked out from every face it paints.
  const images: { bufferView: number; mimeType: "image/png"; name: string }[] = []
  const pictures = new Map<Paint, { image: number; map: Mapping }>()
  const painted = scene.faces.filter((face) => face.paint !== undefined)
  for (const paint of new Set(painted.map((face) => face.paint as Paint))) {
    const texture = paint.texture
    if (texture) {
      const sign = texture.mirrored ? -1 : 1
      images.push({ bufferView: addView(options.png(texture)), mimeType: "image/png", name: texture.mirrored ? "board bottom" : "board top" })
      pictures.set(paint, { image: images.length - 1, map: (p) => [(texture.origin.x + sign * p[0] * texture.pxPerMm) / texture.width, (texture.origin.y - p[1] * texture.pxPerMm) / texture.height] })
      continue
    }
    // A paint that is not a picture changes only up the board (its edge): a strip sampled from the top down.
    let [low, high] = [Infinity, -Infinity]
    for (const face of painted) {
      if (face.paint !== paint) continue
      for (const point of face.loops.flat()) [low, high] = [Math.min(low, point[2]), Math.max(high, point[2])]
    }
    const span = high - low || 1
    const [x, y] = (painted.find((face) => face.paint === paint) as Face).loops[0]?.[0] ?? [0, 0]
    const rgba = new Uint8ClampedArray(STRIP_WIDTH * STRIP_HEIGHT * 4)
    const colour = new Float32Array(3)
    for (let row = 0; row < STRIP_HEIGHT; row++) {
      const alpha = paint.at(x as number, y as number, high - ((row + 0.5) / STRIP_HEIGHT) * span, colour, true)
      for (let column = 0; column < STRIP_WIDTH; column++) rgba.set([colour[0] as number, colour[1] as number, colour[2] as number, alpha * 255], (row * STRIP_WIDTH + column) * 4)
    }
    images.push({ bufferView: addView(options.png({ rgba, width: STRIP_WIDTH, height: STRIP_HEIGHT })), mimeType: "image/png", name: "board edge" })
    pictures.set(paint, { image: images.length - 1, map: (p) => [0.5, (high - p[2]) / span] })
  }

  // The materials, in the order the faces first ask for them.
  const materials: Record<string, unknown>[] = []
  const materialOf = new Map<string, number>()
  const material = (face: Face): number => {
    const picture = face.paint ? pictures.get(face.paint) : undefined
    const key = picture ? `picture ${picture.image}` : `${face.color.join(",")} ${face.alpha} ${face.material ?? "matt"}`
    const known = materialOf.get(key)
    if (known !== undefined) return known
    const made = picture
      ? { name: images[picture.image]?.name, pbrMetallicRoughness: { baseColorTexture: { index: picture.image }, ...BOARD_SURFACE }, ...(face.paint?.texture ? { alphaMode: "MASK", alphaCutoff: 0.5 } : {}) }
      : {
          pbrMetallicRoughness: { baseColorFactor: [linear(face.color[0]), linear(face.color[1]), linear(face.color[2]), face.alpha], ...SURFACE[face.material ?? "matt"] },
          ...(face.alpha < 1 ? { alphaMode: "BLEND" } : {}),
        }
    materials.push(made)
    materialOf.set(key, materials.length - 1)
    return materials.length - 1
  }

  // The meshes: the board's, then each part's by its number; in each, a primitive for each material.
  const owners = [...new Set(scene.faces.map((face) => face.part))].sort((a, b) => a - b)
  const accessors: Record<string, unknown>[] = []
  const meshes: { name: string; primitives: Record<string, unknown>[] }[] = []
  const children: number[] = []
  const nodes: Record<string, unknown>[] = [{ name: options.name, matrix: TO_METRES_Y_UP, children }]
  for (const owner of owners) {
    const gathered = new Map<number, Gathered>()
    for (const face of scene.faces) {
      if (face.part !== owner) continue
      // A face with no area (a wall between two points that are one) has no triangles: it adds nothing.
      const { corners, indices } = triangles(face)
      if (indices.length === 0) continue
      const number = material(face)
      const map = face.paint ? pictures.get(face.paint)?.map : undefined
      const into = gathered.get(number) ?? { material: number, positions: [], normals: [], uvs: map ? [] : undefined, indices: [] }
      gathered.set(number, into)
      const first = into.positions.length / 3
      for (const corner of corners) {
        into.positions.push(...corner)
        into.normals.push(...face.normal)
        if (map) into.uvs?.push(...map(corner))
      }
      for (const index of indices) into.indices.push(first + index)
    }
    if (gathered.size === 0) continue
    const primitives = [...gathered.values()].map((one) => {
      const positions = new Float32Array(one.positions)
      const min = [Infinity, Infinity, Infinity]
      const max = [-Infinity, -Infinity, -Infinity]
      positions.forEach((value, i) => {
        min[i % 3] = Math.min(min[i % 3] as number, value)
        max[i % 3] = Math.max(max[i % 3] as number, value)
      })
      const accessor = (array: Float32Array | Uint32Array, type: string, target: number, more: Record<string, unknown> = {}): number => {
        const width = type === "VEC3" ? 3 : type === "VEC2" ? 2 : 1
        accessors.push({ bufferView: addView(bytesOf(array), target), componentType: array instanceof Float32Array ? FLOAT : UINT, count: array.length / width, type, ...more })
        return accessors.length - 1
      }
      const attributes = {
        POSITION: accessor(positions, "VEC3", ARRAY_BUFFER, { min, max }),
        NORMAL: accessor(new Float32Array(one.normals), "VEC3", ARRAY_BUFFER),
        ...(one.uvs ? { TEXCOORD_0: accessor(new Float32Array(one.uvs), "VEC2", ARRAY_BUFFER) } : {}),
      }
      return { attributes, indices: accessor(new Uint32Array(one.indices), "SCALAR", ELEMENT_ARRAY_BUFFER), material: one.material }
    })
    const name = owner < 0 ? "board" : (options.names[owner] ?? `part ${owner + 1}`)
    meshes.push({ name, primitives })
    nodes.push({ name, mesh: meshes.length - 1 })
    children.push(nodes.length - 1)
  }
  if (meshes.length === 0) throw new Error("Nothing to write: the scene has no faces")

  const bin = new Uint8Array(length)
  chunks.reduce((offset, chunk) => (bin.set(chunk, offset), offset + chunk.length), 0)
  const json = {
    asset: { version: "2.0", generator: "copperflow" },
    scene: 0,
    scenes: [{ name: options.name, nodes: [0] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
    ...(images.length > 0
      ? { images, textures: images.map((_, source) => ({ source, sampler: 0 })), samplers: [{ magFilter: LINEAR, minFilter: LINEAR_MIPMAP_LINEAR, wrapS: CLAMP_TO_EDGE, wrapT: CLAMP_TO_EDGE }] }
      : {}),
  }
  return pack(json, bin)
}
