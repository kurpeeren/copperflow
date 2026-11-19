// The board and its parts as an ISO 10303-21 exchange file, written here without a library. The application protocol
// is AP214 (AUTOMOTIVE_DESIGN): every mechanical CAD program reads it, it carries named products in an assembly, exact
// boundary representations and colours, and the few entities written here mean the same in AP242, so nothing AP242
// adds is needed. The board is a MANIFOLD_SOLID_BREP: planar faces, straight and circular edges, and cylindrical faces
// where a hole or an arc edge runs through it. A part given its faces (the shapes the 3D view draws) is written as
// those faces in their colours (step-faces.ts); a part without them is a box, a MANIFOLD_SOLID_BREP like the board.
// The board and every part is a product of its own ("board", "U1", …), placed without a transformation in one
// assembly named after the design. Units are mm. The text is deterministic: the same model writes the same bytes, so
// the header's time stamp is a fixed one, not the day it was written.
import { VERSION } from "../../version.js"
import type { Point } from "../model.js"
import type { PartSolid, Segment, SolidModel } from "./model.js"
import { Entities, quoted, refList, stepReal, type Vec } from "./step-entities.js"
import { Styles, surfaceModel, type PartFaces } from "./step-faces.js"

const UP: Vec = [0, 0, 1]
const DOWN: Vec = [0, 0, -1]
const EAST: Vec = [1, 0, 0]

const unit = (from: Point, to: Point): Vec => {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  return [(to.x - from.x) / length, (to.y - from.y) / length, 0]
}

interface Ring {
  segment: Segment
  /** The vertices at the segment's start, at the bottom and the top. */
  low: number
  high: number
  /** The edges along the segment at the bottom and the top, and up its start. */
  bottomEdge: number
  topEdge: number
  riser: number
}

/** The edge along a segment at height z, from vertex `a` to `b`. */
function segmentEdge(out: Entities, segment: Segment, z: number, a: number, b: number): number {
  if (segment.kind === "line") return out.add(`EDGE_CURVE('',#${a},#${b},#${out.line([segment.from.x, segment.from.y, z], unit(segment.from, segment.to))},.T.)`)
  const circle = out.add(`CIRCLE('',#${out.placement([segment.centre.x, segment.centre.y, z], UP, EAST)},${stepReal(segment.radius)})`)
  return out.add(`EDGE_CURVE('',#${a},#${b},#${circle},${segment.ccw ? ".T." : ".F."})`)
}

/** The vertices and edges of one loop of the prism: per segment its two start vertices, its two edges and its riser. */
function ring(out: Entities, loop: readonly Segment[], z0: number, z1: number): Ring[] {
  const lows = loop.map((s) => out.add(`VERTEX_POINT('',#${out.point([s.from.x, s.from.y, z0])})`))
  const highs = loop.map((s) => out.add(`VERTEX_POINT('',#${out.point([s.from.x, s.from.y, z1])})`))
  return loop.map((segment, i) => {
    const next = (i + 1) % loop.length
    const [low, high] = [lows[i] as number, highs[i] as number]
    return {
      segment,
      low,
      high,
      bottomEdge: segmentEdge(out, segment, z0, low, lows[next] as number),
      topEdge: segmentEdge(out, segment, z1, high, highs[next] as number),
      riser: out.add(`EDGE_CURVE('',#${low},#${high},#${out.line([segment.from.x, segment.from.y, z0], UP)},.T.)`),
    }
  })
}

const oriented = (out: Entities, edge: number, forward: boolean) => out.add(`ORIENTED_EDGE('',*,*,#${edge},${forward ? ".T." : ".F."})`)
const loopOf = (out: Entities, edges: readonly number[]) => out.add(`EDGE_LOOP('',(${edges.map((e) => `#${e}`).join(",")}))`)
const bound = (out: Entities, loop: number, outer: boolean) => out.add(`${outer ? "FACE_OUTER_BOUND" : "FACE_BOUND"}('',#${loop},.T.)`)
const face = (out: Entities, bounds: readonly number[], surface: number, sameSense: boolean) =>
  out.add(`ADVANCED_FACE('',(${bounds.map((b) => `#${b}`).join(",")}),#${surface},${sameSense ? ".T." : ".F."})`)

/**
 * A prism between z0 and z1 whose first loop is its outline (counter-clockwise seen from the top) and whose other loops
 * are holes (clockwise): the top and bottom faces, and a side face per segment, a plane for a straight edge and a
 * cylinder for an arc. Every face's loops run counter-clockwise seen from outside the solid. Returns the shell.
 */
function prism(out: Entities, loops: readonly (readonly Segment[])[], z0: number, z1: number): number {
  const rings = loops.map((loop) => ring(out, loop, z0, z1))
  const faces: number[] = []
  const top = rings.map((r, i) => bound(out, loopOf(out, r.map((s) => oriented(out, s.topEdge, true))), i === 0))
  faces.push(face(out, top, out.add(`PLANE('',#${out.placement([0, 0, z1], UP, EAST)})`), true))
  const bottom = rings.map((r, i) => bound(out, loopOf(out, [...r].reverse().map((s) => oriented(out, s.bottomEdge, false))), i === 0))
  faces.push(face(out, bottom, out.add(`PLANE('',#${out.placement([0, 0, z0], DOWN, EAST)})`), true))
  for (const r of rings) {
    r.forEach((side, i) => {
      const next = r[(i + 1) % r.length] as Ring
      const edges = [oriented(out, side.bottomEdge, true), oriented(out, next.riser, true), oriented(out, side.topEdge, false), oriented(out, side.riser, false)]
      const { segment } = side
      const surface =
        segment.kind === "line"
          ? (() => {
              const [dx, dy] = unit(segment.from, segment.to)
              return out.add(`PLANE('',#${out.placement([segment.from.x, segment.from.y, z0], [dy, -dx, 0], [dx, dy, 0])})`)
            })()
          : out.add(`CYLINDRICAL_SURFACE('',#${out.placement([segment.centre.x, segment.centre.y, z0], UP, EAST)},${stepReal(segment.radius)})`)
      faces.push(face(out, [bound(out, loopOf(out, edges), true)], surface, segment.kind === "line" ? true : segment.ccw))
    })
  }
  return out.add(`CLOSED_SHELL('',(${faces.map((f) => `#${f}`).join(",")}))`)
}

const boxLoop = (part: PartSolid): Segment[] => part.corners.map((from, i) => ({ kind: "line", from, to: part.corners[(i + 1) % 4] as Point }))

interface Context {
  product: number
  definition: number
  geometry: number
}

/** The shared contexts: application, product, definition, and the 3D context in mm, radians and steradians. */
function contexts(out: Entities): Context {
  const app = out.add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')")
  out.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${app})`)
  const product = out.add(`PRODUCT_CONTEXT('',#${app},'mechanical')`)
  const definition = out.add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${app},'design')`)
  const length = out.add("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))")
  const angle = out.add("(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))")
  const solidAngle = out.add("(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())")
  const accuracy = out.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#${length},'distance_accuracy_value','confusion accuracy')`)
  const geometry = out.add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${accuracy}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${length},#${angle},#${solidAngle}))REPRESENTATION_CONTEXT('Context3D','3D context in mm'))`,
  )
  return { product, definition, geometry }
}

/** A product and its definition; returns the definition and its shape. */
function product(out: Entities, context: Context, name: string): { definition: number; shape: number } {
  const item = out.add(`PRODUCT(${quoted(name)},${quoted(name)},'',(#${context.product}))`)
  const formation = out.add(`PRODUCT_DEFINITION_FORMATION('','',#${item})`)
  const definition = out.add(`PRODUCT_DEFINITION('design','',#${formation},#${context.definition})`)
  return { definition, shape: out.add(`PRODUCT_DEFINITION_SHAPE('','',#${definition})`) }
}

const ORIGIN: Vec = [0, 0, 0]

/** The header's time stamp: the same for every file, so a design always writes the same bytes. */
const FIXED_STAMP = "2000-01-01T00:00:00"

interface Child {
  name: string
  definition: number
  shape: number
  origin: number
  representation: number
}

/** The board or a part as a box: a product whose shape is one MANIFOLD_SOLID_BREP. */
function solidChild(out: Entities, context: Context, name: string, loops: readonly (readonly Segment[])[], z0: number, z1: number): Child {
  const made = product(out, context, name)
  const brep = out.add(`MANIFOLD_SOLID_BREP(${quoted(name)},#${prism(out, loops, z0, z1)})`)
  const origin = out.placement(ORIGIN, UP, EAST)
  const representation = out.add(`ADVANCED_BREP_SHAPE_REPRESENTATION(${quoted(name)},(#${brep},#${origin}),#${context.geometry})`)
  out.add(`SHAPE_DEFINITION_REPRESENTATION(#${made.shape},#${representation})`)
  return { ...made, name, origin, representation }
}

/** A part as its coloured faces: a product whose shape is a surface model, and its faces' styles; none when no face has area. */
function surfaceChild(out: Entities, context: Context, styles: Styles, name: string, faces: PartFaces[number]): Child | undefined {
  const surface = surfaceModel(out, styles, name, faces)
  if (surface === undefined) return undefined
  const made = product(out, context, name)
  const origin = out.placement(ORIGIN, UP, EAST)
  const representation = out.add(`MANIFOLD_SURFACE_SHAPE_REPRESENTATION(${quoted(name)},(#${surface.model},#${origin}),#${context.geometry})`)
  out.add(`SHAPE_DEFINITION_REPRESENTATION(#${made.shape},#${representation})`)
  out.add(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',${refList(surface.styled)},#${context.geometry})`)
  return { ...made, name, origin, representation }
}

/** The assembly's shape and, for each child, its use in the assembly, placed without a transformation. */
function assemble(out: Entities, context: Context, assembly: { definition: number; shape: number }, name: string, children: readonly Child[]): void {
  const places = children.map(() => out.placement(ORIGIN, UP, EAST))
  const assemblyOrigin = out.placement(ORIGIN, UP, EAST)
  const assemblyShape = out.add(`SHAPE_REPRESENTATION(${quoted(name)},${refList([assemblyOrigin, ...places])},#${context.geometry})`)
  out.add(`SHAPE_DEFINITION_REPRESENTATION(#${assembly.shape},#${assemblyShape})`)
  children.forEach((child, i) => {
    const usage = out.add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('NAUO${i + 1}',${quoted(child.name)},'',#${assembly.definition},#${child.definition},$)`)
    const placementShape = out.add(`PRODUCT_DEFINITION_SHAPE('Placement','',#${usage})`)
    const transform = out.add(`ITEM_DEFINED_TRANSFORMATION('','',#${child.origin},#${places[i]})`)
    const relation = out.add(
      `(REPRESENTATION_RELATIONSHIP('','',#${child.representation},#${assemblyShape})REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#${transform})SHAPE_REPRESENTATION_RELATIONSHIP())`,
    )
    out.add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#${relation},#${placementShape})`)
  })
}

const BOXES_DESCRIPTION = "The board and its parts as boxes"
const SHAPES_DESCRIPTION = "The board as a solid and its parts as coloured faces, as copperflow's 3D view draws them"

/**
 * The exchange file of the model: an assembly named `name` holding the board and every part. With `faces` (one list
 * per part of the model, in its order), each part is written as its faces in their colours; without them, or for a
 * part whose faces have no area, as a box.
 */
export function stepText(model: SolidModel, name: string, faces?: PartFaces): string {
  const out = new Entities()
  const context = contexts(out)
  const assembly = product(out, context, name)
  const shapes = faces !== undefined && faces.length === model.parts.length ? faces : undefined
  const styles = new Styles(out)
  const board = model.board ? [solidChild(out, context, "board", [model.board.outline, ...model.board.holes], 0, model.board.thickness)] : []
  let shaped = 0
  const parts = model.parts.map((part, i) => {
    const partFaces = shapes?.[i] ?? []
    const surface = partFaces.length > 0 ? surfaceChild(out, context, styles, part.name, partFaces) : undefined
    if (surface !== undefined) shaped++
    return surface ?? solidChild(out, context, part.name, [boxLoop(part)], part.bottom, part.top)
  })
  assemble(out, context, assembly, name, [...board, ...parts])
  const description = shaped > 0 ? SHAPES_DESCRIPTION : BOXES_DESCRIPTION
  return [
    "ISO-10303-21;\n",
    "HEADER;\n",
    `FILE_DESCRIPTION((${quoted(description)}),'2;1');\n`,
    `FILE_NAME(${quoted(`${name}.step`)},'${FIXED_STAMP}',(''),(''),'copperflow ${VERSION}','copperflow ${VERSION}','');\n`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\n",
    "ENDSEC;\n",
    "DATA;\n",
    out.text(),
    "ENDSEC;\n",
    "END-ISO-10303-21;\n",
  ].join("")
}
