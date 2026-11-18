// The 3D view's scene as a GLB file (studio/src/look/glb.ts): a file a strict reader takes, every face as triangles
// that face the way the face does, the parts as named nodes, the board's pictures as its textures.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../src/engine/design.js"
import { solidModel } from "../src/engine/solid/model.js"
import { sceneGlb, type GlbOptions } from "../studio/src/look/glb.js"
import { texturePaint } from "../studio/src/look/paint.js"
import { partFaces } from "../studio/src/look/parts/index.js"
import { buildScene, type Face, type Paint, type Scene, type Vec3 } from "../studio/src/look/scene.js"
import { boardTextures, type BoardTexture } from "../studio/src/look/texture.js"
import { imageBytes, primitives, readGlb, type ReadPrimitive } from "./helpers/glb-read.js"

/** A stand-in for the PNG encoder: the picture's size as text, so a test can tell which picture an image is. */
const png: GlbOptions["png"] = (image) => new TextEncoder().encode(`png ${image.width}x${image.height}`)
const options = (names: string[] = []): GlbOptions => ({ name: "demo", names, png })

const sceneOf = (faces: Face[]): Scene => ({ faces, bounds: [[0, 0, 0], [1, 1, 1]] })
const face = (loop: Vec3[], normal: Vec3, more: Partial<Face> = {}): Face => ({ loops: [loop], normal, color: [200, 30, 30], alpha: 1, part: 0, ...more })
const SQUARE: Vec3[] = [[0, 0, 1], [2, 0, 1], [2, 2, 1], [0, 2, 1]]

const sub = (a: number[], b: number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]
const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!]
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!

/** The area of a primitive's triangles, and whether each one turns the way its vertices' normals point. */
function measure(primitive: ReadPrimitive) {
  let area = 0
  let facing = true
  for (const [a, b, c] of primitive.triangles as [number, number, number][]) {
    const normal = cross(sub(primitive.positions[b]!, primitive.positions[a]!), sub(primitive.positions[c]!, primitive.positions[a]!))
    area += Math.hypot(...normal) / 2
    if (dot(normal, primitive.normals[a]!) <= 0) facing = false
  }
  return { area, facing }
}

function filesIn(folder: string): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else files[relative(folder, path).split("\\").join("/")] = readFileSync(path, "utf8")
    }
  }
  walk(folder)
  return files
}

const example = (name: string): Design => {
  const folder = join(import.meta.dirname, "..", "examples", name)
  const main = readdirSync(folder).find((file) => file.endsWith(".circuit.tsx")) as string
  return buildDesign(filesIn(folder), main)
}

describe("a scene as a GLB file", () => {
  test("is a version 2 file of a JSON and a BIN chunk, each padded to four bytes, whose buffer is the BIN chunk", () => {
    const bytes = sceneGlb(sceneOf([face(SQUARE, [0, 0, 1])]), options(["R1"]))
    const file = readGlb(bytes)
    expect(file.json.asset.version).toBe("2.0")
    expect(file.json.buffers).toEqual([{ byteLength: file.bin.byteLength }])
    for (const view of file.json.bufferViews) {
      expect(view.byteOffset % 4).toBe(0)
      expect(view.byteOffset + view.byteLength).toBeLessThanOrEqual(file.bin.byteLength)
    }
  })

  test("the same scene is the same bytes", () => {
    const scene = sceneOf([face(SQUARE, [0, 0, 1]), face(SQUARE, [0, 0, 1], { color: [1, 2, 3], part: 1 })])
    expect(sceneGlb(scene, options(["R1", "R2"]))).toEqual(sceneGlb(scene, options(["R1", "R2"])))
  })

  test("a face of four corners is two triangles that face the way the face does, whichever way its corners run", () => {
    const backwards = [...SQUARE].reverse()
    for (const loop of [SQUARE, backwards]) {
      const [only] = primitives(readGlb(sceneGlb(sceneOf([face(loop, [0, 0, 1])]), options(["R1"]))))
      expect(only!.triangles).toHaveLength(2)
      expect(only!.normals).toEqual([[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]])
      expect(measure(only!)).toEqual({ area: 4, facing: true })
    }
  })

  test("a face that turns inwards is cut into triangles that cover it and no more", () => {
    // An L: a 3 x 3 square without its 2 x 2 upper right corner, standing in the x, z plane.
    const el: Vec3[] = [[0, 5, 0], [3, 5, 0], [3, 5, 1], [1, 5, 1], [1, 5, 3], [0, 5, 3]]
    const [only] = primitives(readGlb(sceneGlb(sceneOf([face(el, [0, -1, 0])]), options(["R1"]))))
    const { area, facing } = measure(only!)
    expect(area).toBeCloseTo(5, 6)
    expect(facing).toBe(true)
  })

  test("a face with a hole is cut around it", () => {
    const hole: Vec3[] = [[0.5, 0.5, 1], [0.5, 1.5, 1], [1.5, 1.5, 1], [1.5, 0.5, 1]]
    const [only] = primitives(readGlb(sceneGlb(sceneOf([{ ...face(SQUARE, [0, 0, 1]), loops: [SQUARE, hole] }]), options(["R1"]))))
    expect(measure(only!)).toEqual({ area: 3, facing: true })
  })

  test("every accessor of positions says its smallest and largest, as the format asks", () => {
    const file = readGlb(sceneGlb(sceneOf([face(SQUARE, [0, 0, 1])]), options(["R1"])))
    const position = file.json.accessors[file.json.meshes[0]!.primitives[0]!.attributes.POSITION!]!
    expect(position.min).toEqual([0, 0, 1])
    expect(position.max).toEqual([2, 2, 1])
  })

  test("the board and each part are a node by name under one node that turns millimetres with z up into metres with y up", () => {
    const scene = sceneOf([face(SQUARE, [0, 0, 1], { part: 1 }), face(SQUARE, [0, 0, 1], { part: 0 }), face(SQUARE, [0, 0, 1], { part: -1 })])
    const { json } = readGlb(sceneGlb(scene, options(["R1", "U1"])))
    expect(json.scenes).toEqual([{ name: "demo", nodes: [0] }])
    const root = json.nodes[0]!
    // Column by column: x stays x, the board's y becomes the depth (-z), the board's z becomes the height (y).
    expect(root.matrix).toEqual([0.001, 0, 0, 0, 0, 0, -0.001, 0, 0, 0.001, 0, 0, 0, 0, 0, 1])
    expect(root.children!.map((child) => json.nodes[child]!.name)).toEqual(["board", "R1", "U1"])
    expect(root.children!.map((child) => json.meshes[json.nodes[child]!.mesh!]!.name)).toEqual(["board", "R1", "U1"])
  })

  test("faces of one colour and material share a material: the colour in linear light, metal as metal", () => {
    const scene = sceneOf([
      face(SQUARE, [0, 0, 1], { color: [255, 0, 128], material: "matt" }),
      face(SQUARE, [0, 0, 1], { color: [255, 0, 128], material: "matt", part: 1 }),
      face(SQUARE, [0, 0, 1], { color: [255, 0, 128], material: "metal", part: 1 }),
    ])
    const file = readGlb(sceneGlb(scene, options(["R1", "U1"])))
    expect(file.json.materials).toHaveLength(2)
    const [matt, metal] = file.json.materials
    expect(matt!.pbrMetallicRoughness.baseColorFactor).toEqual([1, 0, 0.2159, 1])
    expect(matt!.pbrMetallicRoughness.metallicFactor).toBe(0)
    expect(metal!.pbrMetallicRoughness.metallicFactor).toBeGreaterThan(0.5)
    expect(metal!.pbrMetallicRoughness.roughnessFactor).toBeLessThan(matt!.pbrMetallicRoughness.roughnessFactor!)
    // U1's two faces are two primitives of one mesh.
    expect(file.json.meshes.map((mesh) => mesh.primitives.length)).toEqual([1, 2])
  })

  test("a see-through face blends", () => {
    const { json } = readGlb(sceneGlb(sceneOf([face(SQUARE, [0, 0, 1], { alpha: 0.45 })]), options(["R1"])))
    expect(json.materials[0]!.alphaMode).toBe("BLEND")
    expect(json.materials[0]!.pbrMetallicRoughness.baseColorFactor![3]).toBe(0.45)
  })

  test("a face painted with the board's picture carries the picture as its texture, each corner at its pixel", () => {
    // 10 px/mm, the board's 0, 0 at pixel 5, 25 of a 40 x 30 picture: x to the right, y up the picture.
    const texture: BoardTexture = { rgba: new Uint8ClampedArray(40 * 30 * 4), width: 40, height: 30, origin: { x: 5, y: 25 }, pxPerMm: 10, mirrored: false }
    const file = readGlb(sceneGlb(sceneOf([face(SQUARE, [0, 0, 1], { part: -1, paint: texturePaint(texture) })]), options()))
    const [only] = primitives(file)
    expect(only!.material.pbrMetallicRoughness.baseColorTexture).toEqual({ index: 0 })
    // The picture is see-through at the board's holes: those pixels are cut away.
    expect(only!.material.alphaMode).toBe("MASK")
    expect(file.json.images).toEqual([{ bufferView: expect.any(Number), mimeType: "image/png", name: "board top" }])
    expect(new TextDecoder().decode(imageBytes(file, 0))).toBe("png 40x30")
    const corners = only!.positions.map((p, i) => [p[0], p[1], ...only!.uvs![i]!.map((value) => Math.round(value * 1000) / 1000)])
    expect(corners).toEqual(expect.arrayContaining([[0, 0, 5 / 40, 0.833], [2, 0, 25 / 40, 0.833], [2, 2, 25 / 40, 0.167], [0, 2, 5 / 40, 0.167]]))
  })

  test("the bottom's picture is mirrored: the board's x runs to the left across it", () => {
    const texture: BoardTexture = { rgba: new Uint8ClampedArray(40 * 30 * 4), width: 40, height: 30, origin: { x: 35, y: 25 }, pxPerMm: 10, mirrored: true }
    const down = [...SQUARE].reverse().map((p): Vec3 => [p[0], p[1], 0])
    const file = readGlb(sceneGlb(sceneOf([face(down, [0, 0, -1], { part: -1, paint: texturePaint(texture) })]), options()))
    const [only] = primitives(file)
    expect(file.json.images![0]!.name).toBe("board bottom")
    const at = (x: number, y: number) => only!.uvs![only!.positions.findIndex((p) => p[0] === x && p[1] === y)]![0]
    expect(at(0, 0)).toBeCloseTo(35 / 40, 6)
    expect(at(2, 0)).toBeCloseTo(15 / 40, 6)
    // Up the board is still up the picture: only left and right change places.
    const across = (x: number, y: number) => only!.uvs![only!.positions.findIndex((p) => p[0] === x && p[1] === y)]![1]
    expect(across(0, 0)).toBeCloseTo(25 / 30, 6)
    expect(across(0, 2)).toBeCloseTo(5 / 30, 6)
  })

  test("a paint that is not a picture (the board's edge) becomes a strip sampled up the face, shared by every face it paints", () => {
    const seen: number[] = []
    const edge: Paint = {
      at(_x, _y, z, out) {
        seen.push(z)
        out[0] = out[1] = out[2] = z > 0.8 ? 255 : 0
        return 1
      },
    }
    const wall = (x: number): Face => face([[x, 0, 0], [x + 1, 0, 0], [x + 1, 0, 1.6], [x, 0, 1.6]], [0, -1, 0], { part: -1, paint: edge })
    const encoded: { width: number; height: number; rgba: Uint8ClampedArray }[] = []
    const file = readGlb(sceneGlb(sceneOf([wall(0), wall(1)]), { ...options(), png: (image) => (encoded.push(image), png(image)) }))
    expect(file.json.images).toHaveLength(1)
    expect(file.json.images![0]!.name).toBe("board edge")
    const strip = encoded[0]!
    expect(strip.height).toBeGreaterThanOrEqual(64)
    expect(Math.min(...seen)).toBeGreaterThan(0)
    expect(Math.max(...seen)).toBeLessThan(1.6)
    // The strip's first row is the top of the board: white here, and its last the bottom.
    expect([...strip.rgba.subarray(0, 4)]).toEqual([255, 255, 255, 255])
    expect([...strip.rgba.subarray(strip.rgba.length - 4)]).toEqual([0, 0, 0, 255])
    const [only] = primitives(file)
    const v = (z: number) => only!.uvs![only!.positions.findIndex((p) => p[2] === z)]![1]
    expect(v(Math.fround(1.6))).toBeCloseTo(0, 6)
    expect(v(0)).toBeCloseTo(1, 6)
  })

  test("a face with no area adds nothing: no corners, no empty primitive, and a part of only such faces has no node", () => {
    // A wall between two points that are one point: the scene gives it a normal of no length.
    const flat = face([[1, 1, 0], [1, 1, 0], [1, 1, 2], [1, 1, 2]], [0, 0, 0])
    const file = readGlb(sceneGlb(sceneOf([face(SQUARE, [0, 0, 1]), flat, { ...flat, part: 1, color: [9, 9, 9] }]), options(["R1", "R2"])))
    expect(file.json.nodes.map((node) => node.name)).toEqual(["demo", "R1"])
    expect(file.json.nodes[0]!.children).toEqual([1])
    expect(file.json.materials).toHaveLength(1)
    expect(file.json.accessors.map((accessor) => accessor.count)).toEqual([4, 4, 6])
    expect(file.json.bufferViews.every((view) => view.byteLength > 0)).toBe(true)
  })

  test("a scene with nothing to draw is refused: the format has no empty file", () => {
    expect(() => sceneGlb(sceneOf([]), options())).toThrow("Nothing to write: the scene has no faces")
    expect(() => sceneGlb(sceneOf([face([[1, 1, 0], [1, 1, 0], [1, 1, 2]], [0, 0, 0])]), options(["R1"]))).toThrow("Nothing to write: the scene has no faces")
  })

  test("a face with two holes is cut around both, and a leaning face keeps its area", () => {
    const big: Vec3[] = [[0, 0, 0], [6, 0, 0], [6, 4, 0], [0, 4, 0]]
    const holeAt = (x: number): Vec3[] => [[x, 1, 0], [x, 2, 0], [x + 1, 2, 0], [x + 1, 1, 0]]
    const [holed] = primitives(readGlb(sceneGlb(sceneOf([{ ...face(big, [0, 0, 1]), loops: [big, holeAt(1), holeAt(4)] }]), options(["R1"]))))
    expect(measure(holed!)).toEqual({ area: 22, facing: true })
    // A 2 x 2 square leaning at 45 degrees: its normal is as much along y as along z.
    const h = Math.SQRT1_2
    const leaning: Vec3[] = [[0, 0, 0], [2, 0, 0], [2, 2 * h, 2 * h], [0, 2 * h, 2 * h]]
    const [lean] = primitives(readGlb(sceneGlb(sceneOf([face(leaning, [0, -h, h])]), options(["R1"]))))
    expect(measure(lean!).area).toBeCloseTo(4, 5)
    expect(measure(lean!).facing).toBe(true)
  })

  test("a part without a name is named by its number", () => {
    const { json } = readGlb(sceneGlb(sceneOf([face(SQUARE, [0, 0, 1], { part: 2 })]), options(["R1"])))
    expect(json.nodes[1]!.name).toBe("part 3")
  })
})

describe("the examples as GLB files", () => {
  test.each(["io-8", "can-node", "relay-driver"])("%s: every part is a node, every triangle faces out, and the board carries its two pictures and its edge", (name) => {
    const design = example(name)
    const model = solidModel(design)
    const textures = boardTextures(design, model, {})
    const scene = buildScene(model, { parts: partFaces(design, model), textures, look: {}, mounting: design.pcb.holes.length, layers: design.pcb.board?.layers ?? 2 })
    const file = readGlb(sceneGlb(scene, { name, names: model.parts.map((part) => part.name), png }))
    const names = file.json.nodes[0]!.children!.map((child) => file.json.nodes[child]!.name)
    expect(names).toEqual(["board", ...model.parts.map((part) => part.name)])
    expect(file.json.images!.map((image) => image.name).sort()).toEqual(["board bottom", "board edge", "board top"])
    const all = primitives(file)
    expect(all.every((primitive) => measure(primitive).facing)).toBe(true)
    // What a strict reader refuses: an accessor or a view of nothing, a normal that is not one long.
    expect(file.json.accessors.every((accessor) => accessor.count > 0)).toBe(true)
    expect(file.json.bufferViews.every((view) => view.byteLength > 0)).toBe(true)
    expect(all.every((primitive) => primitive.normals.every((normal) => Math.abs(Math.hypot(...normal) - 1) < 1e-4))).toBe(true)
    // The scene's faces and the file's triangles cover the same area.
    const sceneArea = scene.faces.reduce((sum, one) => sum + loopArea(one), 0)
    expect(all.reduce((sum, primitive) => sum + measure(primitive).area, 0)).toBeCloseTo(sceneArea, 1)
  })
})

/** A flat face's area: its outline's less its holes'. */
function loopArea(one: Face): number {
  const area = (loop: Vec3[]) => {
    let sum = [0, 0, 0]
    for (let i = 0; i < loop.length; i++) {
      const c = cross(loop[i] as unknown as number[], loop[(i + 1) % loop.length] as unknown as number[])
      sum = [sum[0]! + c[0]!, sum[1]! + c[1]!, sum[2]! + c[2]!]
    }
    return Math.hypot(...sum) / 2
  }
  return area(one.loops[0]!) - one.loops.slice(1).reduce((sum, loop) => sum + area(loop), 0)
}
