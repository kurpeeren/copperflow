// A small reader of ISO 10303-21 text for the tests: splits the DATA section into entities, parses their arguments,
// checks every reference resolves and that the entities copperflow writes have the right number of arguments, and
// measures each solid: whether its shell is closed (every edge used by two faces, once each way) and its volume from
// the faces written (the divergence theorem with F = (0, 0, z): only horizontal planar faces count).

export type Arg = { ref: number } | { str: string } | { enum: string } | { num: number } | { list: Arg[] } | { typed: string; args: Arg[] } | "$" | "*"

export interface Entity {
  id: number
  /** The entity's name; a complex entity's parts joined with "+", in order. */
  name: string
  args: Arg[]
  /** A complex entity's parts. */
  parts?: { name: string; args: Arg[] }[]
}

/** The arguments each simple entity copperflow writes takes. */
const ARITY: Record<string, number> = {
  APPLICATION_CONTEXT: 1,
  APPLICATION_PROTOCOL_DEFINITION: 4,
  PRODUCT_CONTEXT: 3,
  PRODUCT_DEFINITION_CONTEXT: 3,
  PRODUCT: 4,
  PRODUCT_DEFINITION_FORMATION: 3,
  PRODUCT_DEFINITION: 4,
  PRODUCT_DEFINITION_SHAPE: 3,
  SHAPE_DEFINITION_REPRESENTATION: 2,
  SHAPE_REPRESENTATION: 3,
  ADVANCED_BREP_SHAPE_REPRESENTATION: 3,
  MANIFOLD_SOLID_BREP: 2,
  CLOSED_SHELL: 2,
  ADVANCED_FACE: 4,
  FACE_OUTER_BOUND: 3,
  FACE_BOUND: 3,
  EDGE_LOOP: 2,
  ORIENTED_EDGE: 5,
  EDGE_CURVE: 5,
  VERTEX_POINT: 2,
  CARTESIAN_POINT: 2,
  DIRECTION: 2,
  VECTOR: 3,
  LINE: 3,
  CIRCLE: 3,
  PLANE: 2,
  CYLINDRICAL_SURFACE: 3,
  AXIS2_PLACEMENT_3D: 4,
  UNCERTAINTY_MEASURE_WITH_UNIT: 4,
  NEXT_ASSEMBLY_USAGE_OCCURRENCE: 6,
  ITEM_DEFINED_TRANSFORMATION: 4,
  CONTEXT_DEPENDENT_SHAPE_REPRESENTATION: 2,
  PRODUCT_RELATED_PRODUCT_CATEGORY: 3,
}

function tokens(text: string): string[] {
  const found: string[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i] as string
    if (/\s/.test(c)) i++
    else if (c === "'") {
      let j = i + 1
      while (j < text.length && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" ? 2 : 1
      found.push(text.slice(i, j + 1))
      i = j + 1
    } else if ("(),".includes(c)) {
      found.push(c)
      i++
    } else {
      let j = i
      while (j < text.length && !"(),'".includes(text[j] as string) && !/\s/.test(text[j] as string)) j++
      found.push(text.slice(i, j))
      i = j
    }
  }
  return found
}

class Parser {
  private at = 0
  constructor(private readonly items: string[]) {}
  done = () => this.at >= this.items.length
  peek = () => this.items[this.at]
  take(expected?: string): string {
    const item = this.items[this.at++]
    if (item === undefined || (expected !== undefined && item !== expected)) throw new Error(`expected ${expected ?? "more"}, got ${item}`)
    return item
  }
  list(): Arg[] {
    this.take("(")
    const args: Arg[] = []
    if (this.peek() === ")") {
      this.take()
      return args
    }
    for (;;) {
      args.push(this.arg())
      const next = this.take()
      if (next === ")") return args
      if (next !== ",") throw new Error(`expected , or ), got ${next}`)
    }
  }
  arg(): Arg {
    const item = this.peek() as string
    if (item === "(") return { list: this.list() }
    this.take()
    if (item === "$" || item === "*") return item
    if (item.startsWith("'")) return { str: item.slice(1, -1).replace(/''/g, "'") }
    if (item.startsWith("#")) return { ref: Number(item.slice(1)) }
    if (item.startsWith(".")) return { enum: item.slice(1, -1) }
    if (/^[A-Z_][A-Z0-9_]*$/.test(item)) return { typed: item, args: this.list() }
    if (!/^[+-]?\d+(\.\d*)?(E[+-]?\d+)?$/.test(item)) throw new Error(`not a value: ${item}`)
    return { num: Number(item) }
  }
}

export interface StepFile {
  header: string
  entities: Map<number, Entity>
}

/** Parses the file; throws on a syntax error, an unresolved reference or a wrong argument count. */
export function readStep(text: string): StepFile {
  if (!text.startsWith("ISO-10303-21;\n") || !text.endsWith("END-ISO-10303-21;\n")) throw new Error("not an exchange file")
  const header = /HEADER;\n([\s\S]*?)ENDSEC;/.exec(text)?.[1] ?? ""
  const data = /DATA;\n([\s\S]*?)ENDSEC;/.exec(text)?.[1]
  if (data === undefined) throw new Error("no DATA section")
  const entities = new Map<number, Entity>()
  for (const line of data.split(";\n").filter((l) => l.trim() !== "")) {
    const match = /^#(\d+)=(.*)$/s.exec(line)
    if (!match) throw new Error(`not an entity: ${line}`)
    const id = Number(match[1])
    if (entities.has(id)) throw new Error(`#${id} twice`)
    const parser = new Parser(tokens(match[2] as string))
    let entity: Entity
    if (parser.peek() === "(") {
      parser.take("(")
      const parts: { name: string; args: Arg[] }[] = []
      while (parser.peek() !== ")") parts.push({ name: parser.take(), args: parser.list() })
      parser.take(")")
      entity = { id, name: parts.map((p) => p.name).join("+"), args: [], parts }
    } else {
      const name = parser.take()
      entity = { id, name, args: parser.list() }
      const arity = ARITY[name]
      if (arity === undefined) throw new Error(`#${id}: ${name} is not an entity copperflow writes`)
      if (entity.args.length !== arity) throw new Error(`#${id}: ${name} takes ${arity} arguments, has ${entity.args.length}`)
    }
    if (!parser.done()) throw new Error(`#${id}: text after the entity`)
    entities.set(id, entity)
  }
  const check = (arg: Arg, from: number) => {
    if (typeof arg !== "object") return
    if ("ref" in arg && !entities.has(arg.ref)) throw new Error(`#${from} refers to #${arg.ref}, which is not there`)
    if ("list" in arg) arg.list.forEach((a) => check(a, from))
    if ("typed" in arg) arg.args.forEach((a) => check(a, from))
  }
  for (const entity of entities.values()) [...entity.args, ...(entity.parts ?? []).flatMap((p) => p.args)].forEach((a) => check(a, entity.id))
  return { header, entities }
}

const ref = (arg: Arg | undefined): number => {
  if (typeof arg !== "object" || !("ref" in arg)) throw new Error("expected a reference")
  return arg.ref
}
const refs = (arg: Arg | undefined): number[] => {
  if (typeof arg !== "object" || !("list" in arg)) throw new Error("expected a list")
  return arg.list.map(ref)
}
const flag = (arg: Arg | undefined): boolean => typeof arg === "object" && "enum" in arg && arg.enum === "T"
const nums = (arg: Arg | undefined): number[] => {
  if (typeof arg !== "object" || !("list" in arg)) throw new Error("expected numbers")
  return arg.list.map((a) => (typeof a === "object" && "num" in a ? a.num : NaN))
}
const num = (arg: Arg | undefined): number => (typeof arg === "object" && "num" in arg ? arg.num : NaN)
const str = (arg: Arg | undefined): string => (typeof arg === "object" && "str" in arg ? arg.str : "")

export interface SolidReport {
  name: string
  faces: number
  /** Every edge is used by exactly two faces of the shell, once in each direction. */
  closed: boolean
  volume: number
}

/** Each MANIFOLD_SOLID_BREP of the file, by name: its face count, whether it is closed, and its volume. */
export function solids(file: StepFile): SolidReport[] {
  const get = (id: number) => {
    const entity = file.entities.get(id)
    if (!entity) throw new Error(`#${id} missing`)
    return entity
  }
  const point = (id: number) => nums(get(ref(get(id).args[1])).args[1])
  return [...file.entities.values()]
    .filter((e) => e.name === "MANIFOLD_SOLID_BREP")
    .map((brep) => {
      const shell = get(ref(brep.args[1]))
      const faces = refs(shell.args[1]).map(get)
      const uses = new Map<number, { t: number; f: number }>()
      let volume = 0
      for (const face of faces) {
        const surface = get(ref(face.args[2]))
        const placement = get(ref(surface.args[1]))
        const axis = nums(get(ref(placement.args[2])).args[1])
        const horizontal = surface.name === "PLANE" && Math.abs(axis[0] ?? 0) < 1e-12 && Math.abs(axis[1] ?? 0) < 1e-12
        const z = nums(get(ref(placement.args[1])).args[1])[2] ?? 0
        for (const boundId of refs(face.args[1])) {
          const loop = get(ref(get(boundId).args[1]))
          let area = 0
          for (const orientedId of refs(loop.args[1])) {
            const oriented = get(orientedId)
            const forward = flag(oriented.args[4])
            const edgeId = ref(oriented.args[3])
            const use = uses.get(edgeId) ?? { t: 0, f: 0 }
            uses.set(edgeId, forward ? { ...use, t: use.t + 1 } : { ...use, f: use.f + 1 })
            if (!horizontal) continue
            const edge = get(edgeId)
            const [start, end] = [point(ref(edge.args[1])), point(ref(edge.args[2]))]
            const [a, b] = forward ? [start, end] : [end, start]
            area += ((a[0] ?? 0) * (b[1] ?? 0) - (b[0] ?? 0) * (a[1] ?? 0)) / 2
            const curve = get(ref(edge.args[3]))
            if (curve.name !== "CIRCLE") continue
            const circlePlace = get(ref(curve.args[1]))
            const centre = nums(get(ref(circlePlace.args[1])).args[1])
            const up = (nums(get(ref(circlePlace.args[2])).args[1])[2] ?? 1) > 0
            const radius = num(curve.args[2])
            const ccw = (flag(edge.args[4]) === forward) === up
            const angle = (p: number[]) => Math.atan2((p[1] ?? 0) - (centre[1] ?? 0), (p[0] ?? 0) - (centre[0] ?? 0))
            let sweep = ccw ? angle(b) - angle(a) : angle(a) - angle(b)
            while (sweep <= 1e-12) sweep += 2 * Math.PI
            const theta = ccw ? sweep : -sweep
            area += (radius ** 2 * (theta - Math.sin(theta))) / 2
          }
          volume += z * area
        }
      }
      const closed = [...uses.values()].every((use) => use.t === 1 && use.f === 1)
      return { name: str(brep.args[0]), faces: faces.length, closed, volume }
    })
}

/** The names of the products, in file order. */
export const productNames = (file: StepFile): string[] => [...file.entities.values()].filter((e) => e.name === "PRODUCT").map((e) => str(e.args[0]))
