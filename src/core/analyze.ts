import { parse } from "@babel/parser"
import type { File, JSXAttribute, JSXElement, Node } from "@babel/types"
import { drawingKindOf } from "../engine/drawing-kinds.js"
import { NAME_NOT_LITERAL, scanDrawings, type DrawingTag, type NamedElement } from "./drawing-scan.js"
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
  /** By drawing id. */
  drawingNodes: Map<string, JSXElement>
}

/** What every element is, whatever its tag. */
interface ElementFacts {
  tag: string
  node: JSXElement
  line: number
  start: number
  end: number
  attributes: JSXAttribute[]
  props: Record<string, PropInfo>
  readonlyReason?: string
  inCallback: boolean
  hasSpread: boolean
}

export function parseSource(source: string): File {
  try {
    return parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] })
  } catch (error) {
    throw new SyntaxError(`Could not parse the circuit file: ${(error as Error).message}`)
  }
}

/** Reads parts, traces, drawings and their literal props from circuit source code. */
export function analyzeCircuit(source: string): CircuitModel {
  return scanCircuit(source).model
}

export function scanCircuit(source: string): Scan {
  const scan: Scan = {
    model: { parts: [], traces: [], drawings: [], skipped: [], imports: [] },
    partNodes: new Map(),
    traceNodes: [],
    drawingNodes: new Map(),
  }
  const drawingTags: DrawingTag[] = []
  const named: NamedElement[] = []
  walk(parseSource(source), [], (node, ancestors) => {
    if (node.type === "JSXElement") collectElement(source, readElement(source, node, ancestors), ancestors, scan, { drawingTags, named })
    if (node.type === "ImportDeclaration") {
      for (const specifier of node.specifiers) {
        scan.model.imports.push({ local: specifier.local.name, source: node.source.value, end: node.end ?? 0 })
      }
    }
  })
  const drawings = scanDrawings(drawingTags, named)
  scan.model.drawings = drawings.drawings
  scan.model.skipped.push(...drawings.skipped)
  scan.drawingNodes = drawings.nodes
  return scan
}

function readElement(source: string, node: JSXElement, ancestors: Node[]): ElementFacts {
  const opening = node.openingElement
  const attributes = opening.attributes.filter((a): a is JSXAttribute => a.type === "JSXAttribute")
  const hasSpread = opening.attributes.some((a) => a.type === "JSXSpreadAttribute")
  const inCallback = isInsideCallback(ancestors)
  const readonlyReason = inCallback ? INSIDE_CALLBACK : hasSpread ? USES_SPREAD : undefined
  return {
    tag: slice(source, opening.name),
    node,
    line: node.loc?.start.line ?? 0,
    start: node.start ?? 0,
    end: node.end ?? 0,
    attributes,
    props: readProps(source, attributes),
    ...(readonlyReason ? { readonlyReason } : {}),
    inCallback,
    hasSpread,
  }
}

function collectElement(
  source: string,
  element: ElementFacts,
  ancestors: Node[],
  scan: Scan,
  found: { drawingTags: DrawingTag[]; named: NamedElement[] },
): void {
  if (element.tag === "board") {
    const close = element.node.closingElement?.start
    if (close != null) scan.model.boardClose = { start: close }
    return
  }
  if (element.tag === "trace") return collectTrace(source, element, ancestors, scan)
  const kind = drawingKindOf(element.tag)
  if (kind) {
    found.drawingTags.push({ ...element, kind })
    return
  }
  const part = collectPart(element, scan)
  if (part) found.named.push({ name: part.name, tag: part.tag, inCallback: element.inCallback })
}

function collectTrace(source: string, element: ElementFacts, ancestors: Node[], scan: Scan): void {
  const { props, readonlyReason, attributes } = element
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
    line: element.line,
    editable: reason === undefined,
    ...(reason ? { readonlyReason: reason } : {}),
    start: element.start,
    end: element.end,
  }
  scan.model.traces.push(trace)
  scan.traceNodes.push(element.node)
}

/** Adds a named element as a part; returns it, or undefined when it has no name, a computed one or a repeated one. */
function collectPart(element: ElementFacts, scan: Scan): PartInfo | undefined {
  const { tag, line, props, readonlyReason } = element
  const nameProp = props.name
  if (nameProp === undefined) return undefined
  if (typeof nameProp.literal !== "string") {
    scan.model.skipped.push({ tag, line, reason: NAME_NOT_LITERAL })
    return undefined
  }
  const part: PartInfo = {
    name: nameProp.literal,
    tag,
    line,
    props: omit(props, ["name"]),
    editable: readonlyReason === undefined,
    ...(readonlyReason ? { readonlyReason } : {}),
    start: element.start,
    end: element.end,
  }
  if (scan.partNodes.has(part.name)) {
    scan.model.skipped.push({ tag, line, reason: `duplicate name ${part.name}` })
    return undefined
  }
  scan.model.parts.push(part)
  scan.partNodes.set(part.name, element.node)
  return part
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
