// A part written as the faces the 3D view draws it with, for the STEP file (step.ts). The faces are flat polygons
// (an outline and any holes) that touch, overlap and leave the bottom open, so they are not a solid: each part is a
// SHELL_BASED_SURFACE_MODEL of one OPEN_SHELL, in a MANIFOLD_SURFACE_SHAPE_REPRESENTATION, the form OpenCascade
// itself writes for a shape that is not closed. Every face is an ADVANCED_FACE on a PLANE bounded by straight
// EDGE_CURVEs; a part's vertices are written once, and an edge once for the two faces it joins. Each face is coloured
// by a STYLED_ITEM, and every face of one colour, in any part, refers to the same style. AP214 has no transparency,
// so a see-through face is written opaque in its colour.
import { Entities, quoted, refList, stepReal, type Vec } from "./step-entities.js"

/** One flat face of a part, in the board's frame (mm, z up from the board's bottom). */
export interface StepFace {
  /** The first loop is the outline, any others are holes; all in one plane. */
  loops: readonly (readonly Vec[])[]
  /** Pointing out of the part. */
  normal: Vec
  /** 0 to 255 each. */
  color: readonly [number, number, number]
  /** 1 is opaque. */
  alpha: number
}

/** Each part's faces, in the model's order of parts. */
export type PartFaces = readonly (readonly StepFace[])[]

/** The parts' shapes for a STEP writer: the faces, or why there are none and the parts are boxes. */
export interface PartShapes {
  faces?: PartFaces
  /** Why the shapes could not be had; the parts are then boxes. */
  missing?: string
}

/** Vertices closer than this (mm) on every axis are one vertex: float noise from turning a part, not geometry. */
const MERGE_GRID = 1e-8
/** A loop enclosing less than this area (mm², doubled) is a sliver, not a face. */
const MIN_DOUBLED_AREA = 1e-12
const COLOUR_LEVELS = 255
/** A colour's channels are written to four decimals: finer than 1/255. */
const COLOUR_ROUNDING = 1e4

/** A channel of 0 to 255 as the format's 0 to 1; one that is not a number is 0. */
const channel = (c: number) => (Number.isFinite(c) ? Math.round((Math.min(COLOUR_LEVELS, Math.max(0, c)) / COLOUR_LEVELS) * COLOUR_ROUNDING) / COLOUR_ROUNDING : 0)

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const length = (a: Vec) => Math.hypot(a[0], a[1], a[2])
const scaled = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k]
const normalised = (a: Vec): Vec | undefined => {
  const l = length(a)
  return l > 0 && Number.isFinite(l) ? scaled(a, 1 / l) : undefined
}

/** The loop's area vector (Newell's method): its direction is the loop's normal by the right hand, its length twice its area. */
function areaVector(loop: readonly Vec[]): Vec {
  let [x, y, z] = [0, 0, 0]
  loop.forEach((p, i) => {
    const q = loop[(i + 1) % loop.length] as Vec
    x += (p[1] - q[1]) * (p[2] + q[2])
    y += (p[2] - q[2]) * (p[0] + q[0])
    z += (p[0] - q[0]) * (p[1] + q[1])
  })
  return [x, y, z]
}

/** Any unit vector square to `n`. */
function across(n: Vec): Vec {
  const helper: Vec = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  return normalised(sub(helper, scaled(n, dot(helper, n)))) as Vec
}

/** One presentation style per colour, written when first used and shared by every face of that colour in the file. */
export class Styles {
  private readonly byColour = new Map<string, number>()
  constructor(private readonly out: Entities) {}
  of(color: StepFace["color"]): number {
    const key = color.join(",")
    const known = this.byColour.get(key)
    if (known !== undefined) return known
    const out = this.out
    const rgb = color.map((c) => stepReal(channel(c))).join(",")
    const colour = out.add(`COLOUR_RGB('',${rgb})`)
    const fill = out.add(`FILL_AREA_STYLE('',(#${out.add(`FILL_AREA_STYLE_COLOUR('',#${colour})`)}))`)
    const side = out.add(`SURFACE_SIDE_STYLE('',(#${out.add(`SURFACE_STYLE_FILL_AREA(#${fill})`)}))`)
    const style = out.add(`PRESENTATION_STYLE_ASSIGNMENT((#${out.add(`SURFACE_STYLE_USAGE(.BOTH.,#${side})`)}))`)
    this.byColour.set(key, style)
    return style
  }
}

/** A vertex of the part: its point and the VERTEX_POINT. */
interface Vertex {
  at: Vec
  point: number
  vertex: number
}

/** An edge between two vertices of the part, drawn from `from`. */
interface Edge {
  id: number
  from: Vertex
}

/**
 * The vertices and planes of one part, each written once however many faces use it, and its edges: an edge is shared
 * by at most two faces that run along it in opposite directions, as in a manifold surface, so pieces that touch along
 * an edge, or faces that lie on each other, do not make an edge with three or four faces (which readers split up).
 */
class PartTopology {
  private readonly vertices = new Map<string, Vertex>()
  private readonly edges = new Map<string, Edge[]>()
  /** "edge id:T" or "edge id:F" for each direction an edge is already used in. */
  private readonly used = new Set<string>()
  private readonly planes = new Map<string, number>()
  constructor(private readonly out: Entities) {}

  /** The PLANE through `at` facing `normal`, shared by every face of the part in the same plane. */
  planeOf(at: Vertex, normal: Vec, ref: Vec): number {
    const normalId = this.out.sharedDirection(normal)
    const key = `${normalId}:${Math.round(dot(normal, at.at) / MERGE_GRID)}`
    const known = this.planes.get(key)
    if (known !== undefined) return known
    const placement = this.out.add(`AXIS2_PLACEMENT_3D('',#${at.point},#${normalId},#${this.out.sharedDirection(ref)})`)
    const plane = this.out.add(`PLANE('',#${placement})`)
    this.planes.set(key, plane)
    return plane
  }

  vertexOf(p: Vec): Vertex {
    const key = p.map((c) => Math.round(c / MERGE_GRID)).join(",")
    const known = this.vertices.get(key)
    if (known !== undefined) return known
    const point = this.out.point(p)
    const made = { at: p, point, vertex: this.out.add(`VERTEX_POINT('',#${point})`) }
    this.vertices.set(key, made)
    return made
  }

  /** The ORIENTED_EDGE from `a` to `b`: along an edge of that pair not yet used in this direction, or a new one. */
  orientedEdge(a: Vertex, b: Vertex): number {
    const key = a.vertex < b.vertex ? `${a.vertex}-${b.vertex}` : `${b.vertex}-${a.vertex}`
    const sense = (edge: Edge) => `${edge.id}:${edge.from === a ? "T" : "F"}`
    const known = this.edges.get(key) ?? []
    const edge = known.find((e) => !this.used.has(sense(e))) ?? this.newEdge(key, known, a, b)
    this.used.add(sense(edge))
    return this.out.add(`ORIENTED_EDGE('',*,*,#${edge.id},${edge.from === a ? ".T." : ".F."})`)
  }

  private newEdge(key: string, known: readonly Edge[], a: Vertex, b: Vertex): Edge {
    const along = normalised(sub(b.at, a.at)) ?? across([0, 0, 1])
    const vector = this.out.shared(`VECTOR('',#${this.out.sharedDirection(along)},1.)`)
    const line = this.out.add(`LINE('',#${a.point},#${vector})`)
    const edge = { id: this.out.add(`EDGE_CURVE('',#${a.vertex},#${b.vertex},#${line},.T.)`), from: a }
    this.edges.set(key, [...known, edge])
    return edge
  }
}

/** The loop as the part's vertices, without a vertex repeated next to itself; too few left is no loop. */
function loopVertices(topology: PartTopology, loop: readonly Vec[]): Vertex[] | undefined {
  const vertices: Vertex[] = []
  for (const p of loop) {
    if (!p.every(Number.isFinite)) return undefined
    const v = topology.vertexOf(p)
    if (vertices[vertices.length - 1] !== v) vertices.push(v)
  }
  while (vertices.length > 1 && vertices[0] === vertices[vertices.length - 1]) vertices.pop()
  return vertices.length >= 3 ? vertices : undefined
}

/** The face's loops turned so the outline runs counter-clockwise about its normal and every hole clockwise, and that normal. */
function orientedLoops(topology: PartTopology, face: StepFace): { loops: Vertex[][]; normal: Vec } | undefined {
  const [outline, ...holes] = face.loops.map((loop) => loopVertices(topology, loop))
  if (outline === undefined) return undefined
  const area = areaVector(outline.map((v) => v.at))
  if (length(area) < MIN_DOUBLED_AREA) return undefined
  const normal = normalised(face.normal) ?? (normalised(area) as Vec)
  const turned = (loop: Vertex[], outer: boolean) => ((dot(areaVector(loop.map((v) => v.at)), normal) > 0) === outer ? loop : [...loop].reverse())
  const kept = holes.filter((hole): hole is Vertex[] => hole !== undefined && length(areaVector(hole.map((v) => v.at))) >= MIN_DOUBLED_AREA)
  return { loops: [turned(outline, true), ...kept.map((hole) => turned(hole, false))], normal }
}

/** The face as an ADVANCED_FACE on its plane, or none when it has no area. */
function advancedFace(out: Entities, topology: PartTopology, face: StepFace): number | undefined {
  const shaped = orientedLoops(topology, face)
  if (shaped === undefined) return undefined
  const { loops, normal } = shaped
  const first = loops[0] as Vertex[]
  const edge = sub((first[1] as Vertex).at, (first[0] as Vertex).at)
  const ref = normalised(sub(edge, scaled(normal, dot(edge, normal)))) ?? across(normal)
  const plane = topology.planeOf(first[0] as Vertex, normal, ref)
  const bounds = loops.map((loop, i) => {
    const edges = loop.map((v, j) => topology.orientedEdge(v, loop[(j + 1) % loop.length] as Vertex))
    const edgeLoop = out.add(`EDGE_LOOP('',${refList(edges)})`)
    return out.add(`${i === 0 ? "FACE_OUTER_BOUND" : "FACE_BOUND"}('',#${edgeLoop},.T.)`)
  })
  return out.add(`ADVANCED_FACE('',${refList(bounds)},#${plane},.T.)`)
}

/** A part written as its faces: the surface model and the STYLED_ITEMs that colour its faces; none when no face has area. */
export function surfaceModel(out: Entities, styles: Styles, name: string, faces: readonly StepFace[]): { model: number; styled: number[] } | undefined {
  const topology = new PartTopology(out)
  const written = faces.flatMap((face) => {
    const id = advancedFace(out, topology, face)
    return id === undefined ? [] : [{ id, color: face.color }]
  })
  if (written.length === 0) return undefined
  const shell = out.add(`OPEN_SHELL('',${refList(written.map((w) => w.id))})`)
  const model = out.add(`SHELL_BASED_SURFACE_MODEL(${quoted(name)},(#${shell}))`)
  const styled = written.map((w) => out.add(`STYLED_ITEM('color',(#${styles.of(w.color)}),#${w.id})`))
  return { model, styled }
}
