// Reads a GLB file (binary glTF 2.0) back for the tests: its JSON, its binary chunk, and each primitive's triangles
// with the positions, normals and texture coordinates its accessors point at.

export interface GlbFile {
  json: GltfJson
  bin: Uint8Array
}

export interface GltfJson {
  asset: { version: string; generator?: string }
  scene: number
  scenes: { name?: string; nodes: number[] }[]
  nodes: { name?: string; mesh?: number; children?: number[]; matrix?: number[] }[]
  meshes: { name?: string; primitives: { attributes: Record<string, number>; indices: number; material: number; mode?: number }[] }[]
  materials: {
    name?: string
    pbrMetallicRoughness: { baseColorFactor?: number[]; baseColorTexture?: { index: number }; metallicFactor?: number; roughnessFactor?: number }
    alphaMode?: string
    alphaCutoff?: number
    doubleSided?: boolean
  }[]
  accessors: { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[]
  bufferViews: { buffer: number; byteOffset: number; byteLength: number; target?: number }[]
  buffers: { byteLength: number }[]
  images?: { bufferView: number; mimeType: string; name?: string }[]
  textures?: { source: number; sampler?: number }[]
  samplers?: Record<string, number>[]
}

const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942

/** Splits the file into its two chunks, checking the header and the padding as a strict reader would. */
export function readGlb(bytes: Uint8Array): GlbFile {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB file: wrong magic")
  if (view.getUint32(4, true) !== 2) throw new Error("not GLB version 2")
  if (view.getUint32(8, true) !== bytes.byteLength) throw new Error("the header's length is not the file's")
  const jsonLength = view.getUint32(12, true)
  if (view.getUint32(16, true) !== JSON_CHUNK) throw new Error("the first chunk is not JSON")
  if (jsonLength % 4 !== 0) throw new Error("the JSON chunk is not padded to four bytes")
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as GltfJson
  const binStart = 20 + jsonLength
  const binLength = view.getUint32(binStart, true)
  if (view.getUint32(binStart + 4, true) !== BIN_CHUNK) throw new Error("the second chunk is not BIN")
  if (binLength % 4 !== 0) throw new Error("the BIN chunk is not padded to four bytes")
  if (binStart + 8 + binLength !== bytes.byteLength) throw new Error("bytes after the BIN chunk")
  return { json, bin: bytes.subarray(binStart + 8, binStart + 8 + binLength) }
}

const WIDTH: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3 }

/** An accessor's numbers, as rows of its type's width. */
export function accessorRows(file: GlbFile, index: number): number[][] {
  const accessor = file.json.accessors[index]!
  const bufferView = file.json.bufferViews[accessor.bufferView]!
  const width = WIDTH[accessor.type]!
  const view = new DataView(file.bin.buffer, file.bin.byteOffset + bufferView.byteOffset, bufferView.byteLength)
  const read = accessor.componentType === 5126 ? (at: number) => view.getFloat32(at, true) : (at: number) => view.getUint32(at, true)
  return Array.from({ length: accessor.count }, (_, row) => Array.from({ length: width }, (_, column) => read((row * width + column) * 4)))
}

export interface ReadPrimitive {
  mesh: string
  material: GltfJson["materials"][number]
  positions: number[][]
  normals: number[][]
  uvs?: number[][]
  /** Three vertex numbers a triangle. */
  triangles: number[][]
}

/** Every primitive of every mesh, read through its accessors. */
export function primitives(file: GlbFile): ReadPrimitive[] {
  return file.json.meshes.flatMap((mesh) =>
    mesh.primitives.map((primitive) => {
      const flat = accessorRows(file, primitive.indices).map((row) => row[0]!)
      const uv = primitive.attributes.TEXCOORD_0
      return {
        mesh: mesh.name ?? "",
        material: file.json.materials[primitive.material]!,
        positions: accessorRows(file, primitive.attributes.POSITION!),
        normals: accessorRows(file, primitive.attributes.NORMAL!),
        ...(uv !== undefined ? { uvs: accessorRows(file, uv) } : {}),
        triangles: Array.from({ length: flat.length / 3 }, (_, i) => flat.slice(i * 3, i * 3 + 3)),
      }
    }),
  )
}

/** The bytes of an embedded image. */
export function imageBytes(file: GlbFile, index: number): Uint8Array {
  const view = file.json.bufferViews[file.json.images![index]!.bufferView]!
  return file.bin.subarray(view.byteOffset, view.byteOffset + view.byteLength)
}
