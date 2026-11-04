import { parse } from "@babel/parser"
import type { File, JSXAttribute, JSXElement, Node } from "@babel/types"
import { readLiteral, readPointList } from "./literals.js"
import type { CircuitModel, PartInfo, Point, PropInfo, TraceInfo } from "./types.js"

const SKIP_KEYS = new Set(["loc", "start", "end", "extra", "comments", "leadingComments", "trailingComments", "innerComments"])
const FUNCTION_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "FunctionDeclaration",
  "ObjectMethod",
  "ClassMethod",
])
const JSX_TYPES = new Set(["JSXElement", "JSXFragment"])

export const INSIDE_CALLBACK = "inside a callback such as .map()"
export const USES_SPREAD = "uses spread props"

/** The parsed circuit plus the AST nodes behind it, for editing. */
export interface Scan {
  model: CircuitModel
  partNodes: Map<string, JSXElement>
  traceNodes: JSXElement[]
}

export function parseSource(source: string): File {
  try {
    return parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] })
  } catch (error) {
    throw new SyntaxError(`Could not parse the circuit file: ${(error as Error).message}`)
  }
}

/** Reads parts, traces and their literal props from circuit source code. */
export function analyzeCircuit(source: string): CircuitModel {
  return scanCircuit(source).model
}

export function scanCircuit(source: string): Scan {
  const scan: Scan = { model: { parts: [], traces: [], skipped: [], imports: [] }, partNodes: new Map(), traceNodes: [] }
  walk(parseSource(source), [], (node, ancestors) => {
    if (node.type === "JSXElement") collectElement(source, node, ancestors, scan)
    if (node.type === "ImportDeclaration") {
      for (const specifier of node.specifiers) {
        scan.model.imports.push({ local: specifier.local.name, source: node.source.value, end: node.end ?? 0 })
      }
    }
  })
  return scan
}

function collectElement(source: string, node: JSXElement, ancestors: Node[], scan: Scan): void {
  const opening = node.openingElement
  const tag = slice(source, opening.name)
  const line = node.loc?.start.line ?? 0
  const start = node.start ?? 0
  const end = node.end ?? 0
  const attributes = opening.attributes.filter((a): a is JSXAttribute => a.type === "JSXAttribute")
  const hasSpread = opening.attributes.some((a) => a.type === "JSXSpreadAttribute")
  const readonlyReason = isInsideCallback(ancestors) ? INSIDE_CALLBACK : hasSpread ? USES_SPREAD : undefined
  const props = readProps(source, attributes)

  if (tag === "board") {
    if (node.closingElement?.start != null) scan.model.boardClose = { start: node.closingElement.start }
    return
  }
  if (tag === "trace") {
    const from = props.from?.literal
    const to = props.to?.literal
    const literalEnds = typeof from === "string" && typeof to === "string"
    const reason = readonlyReason ?? (literalEnds ? undefined : "from or to is not a string literal")
    const parentElement = [...ancestors].reverse().find((a): a is JSXElement => a.type === "JSXElement")
    const trace: TraceInfo = {
      from: typeof from === "string" ? from : undefined,
      to: typeof to === "string" ? to : undefined,
      ...(parentElement ? { parent: slice(source, parentElement.openingElement.name) } : {}),
      ...hintsOf(attributes),
      props: omit(props, ["from", "to"]),
      line,
      editable: reason === undefined,
      ...(reason ? { readonlyReason: reason } : {}),
      start,
      end,
    }
    scan.model.traces.push(trace)
    scan.traceNodes.push(node)
    return
  }

  const nameProp = props.name
  if (nameProp === undefined) return
  if (typeof nameProp.literal !== "string") {
    scan.model.skipped.push({ tag, line, reason: "name is not a string literal" })
    return
  }
  const part: PartInfo = {
    name: nameProp.literal,
    tag,
    line,
    props: omit(props, ["name"]),
    editable: readonlyReason === undefined,
    ...(readonlyReason ? { readonlyReason } : {}),
    start,
    end,
  }
  if (scan.partNodes.has(part.name)) {
    scan.model.skipped.push({ tag, line, reason: `duplicate name ${part.name}` })
    return
  }
  scan.model.parts.push(part)
  scan.partNodes.set(part.name, node)
}

function readProps(source: string, attributes: JSXAttribute[]): Record<string, PropInfo> {
  // fromEntries keeps a prop named __proto__ as an own property instead of setting the prototype.
  return Object.fromEntries(
    attributes.map((attribute): [string, PropInfo] => {
      const literal = readLiteral(attribute.value)
      const info = { literal, source: attribute.value ? slice(source, attribute.value) : "", editable: literal !== undefined }
      return [slice(source, attribute.name), info]
    }),
  )
}

/** True when a function boundary sits between the element and an enclosing JSX element. */
function isInsideCallback(ancestors: Node[]): boolean {
  let lastFunction = -1
  ancestors.forEach((node, index) => {
    if (FUNCTION_TYPES.has(node.type)) lastFunction = index
  })
  return lastFunction > 0 && ancestors.slice(0, lastFunction).some((node) => JSX_TYPES.has(node.type))
}

function walk(node: Node, ancestors: Node[], visit: (node: Node, ancestors: Node[]) => void): void {
  visit(node, ancestors)
  ancestors.push(node)
  for (const [key, value] of Object.entries(node)) {
    if (SKIP_KEYS.has(key)) continue
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) walk(child, ancestors, visit)
    } else if (isNode(value)) {
      walk(value, ancestors, visit)
    }
  }
  ancestors.pop()
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string"
}

function slice(source: string, node: Node): string {
  return source.slice(node.start ?? 0, node.end ?? 0)
}

/** The hand-drawn corners of a trace, when they are written as a literal list. */
function hintsOf(attributes: JSXAttribute[]): { schematicRouteHints?: Point[] } {
  const attribute = attributes.find((a) => a.name.type === "JSXIdentifier" && a.name.name === "schematicRouteHints")
  const points = readPointList(attribute?.value)
  return points ? { schematicRouteHints: points } : {}
}

function omit<T>(record: Record<string, T>, keys: string[]): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)))
}
