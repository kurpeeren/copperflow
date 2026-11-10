import { parse } from "@babel/parser"
import type { File, JSXAttribute, JSXElement, Node } from "@babel/types"
import { drawingKindOf } from "../engine/drawing-kinds.js"
import { MAIN_PAGE } from "../engine/model.js"
import { parseLength } from "../engine/units.js"
import { isBoardItemTag, scanBoardItems, type BoardItemTagFacts } from "./board-items.js"
import { NAME_NOT_LITERAL, scanDrawings, type DrawingTag, type NamedElement } from "./drawing-scan.js"
import { readLiteral, readPoint, readPointList } from "./literals.js"
import type { BoardBox, CircuitModel, PartInfo, Point, PropInfo, TraceInfo } from "./types.js"

const SKIP_KEYS = new Set(["loc", "start", "end", "extra", "comments", "leadingComments", "trailingComments", "innerComments"])
const FUNCTION_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "FunctionDeclaration",
  "ObjectMethod",
  "ClassMethod",
])
const JSX_TYPES = new Set(["JSXElement", "JSXFragment"])
const CONDITION_TYPES = new Set(["ConditionalExpression", "LogicalExpression"])

export const INSIDE_CALLBACK = "inside a callback such as .map()"
export const INSIDE_CONDITION = "inside a condition such as && or ?:"
export const INSIDE_HELPER = "inside a helper component, which may draw it any number of times"
export const USES_SPREAD = "uses spread props"

/** The parsed circuit plus the AST nodes behind it, for editing. */
export interface Scan {
  model: CircuitModel
  partNodes: Map<string, JSXElement>
  traceNodes: JSXElement[]
  /** By drawing id. */
  drawingNodes: Map<string, JSXElement>
  /** The pours and holes, by their ids ("copperpour:1", "hole:1"). */
  boardItemNodes: Map<string, JSXElement>
  /** The `<page>` elements, in the order of `model.pages`. */
  pageNodes: JSXElement[]
  /** A sheet file's `<sheet>` element. */
  sheetNode?: JSXElement
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
  /** Tag of the enclosing element, e.g. "board" or "group". */
  parent?: string
  /** The name of the enclosing `<page>`, when it is a literal other than "Main". */
  page?: string
  /** Why the engine may make it any number of times, none included; undefined when it makes it once. */
  uncounted?: string
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
    model: { parts: [], traces: [], drawings: [], boardItems: [], skipped: [], imports: [], pages: [] },
    partNodes: new Map(),
    traceNodes: [],
    drawingNodes: new Map(),
    boardItemNodes: new Map(),
    pageNodes: [],
  }
  const drawingTags: DrawingTag[] = []
  const boardTags: BoardItemTagFacts[] = []
  const named: NamedElement[] = []
  const file = parseSource(source)
  const circuit = circuitFunction(file)
  walk(file, [], (node, ancestors) => {
    if (node.type === "JSXElement") collectElement(source, readElement(source, node, ancestors, circuit), ancestors, scan, { drawingTags, boardTags, named })
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
  const board = scanBoardItems(boardTags)
  scan.model.boardItems = board.items
  scan.boardItemNodes = board.nodes
  return scan
}

/** The function the file exports as its circuit (`export default () => …`, or a function exported by name), if any. */
function circuitFunction(file: File): Node | undefined {
  const exported = file.program.body.find((statement) => statement.type === "ExportDefaultDeclaration")?.declaration
  if (exported === undefined || FUNCTION_TYPES.has(exported.type)) return exported
  if (exported.type !== "Identifier") return undefined
  for (const statement of file.program.body) {
    if (statement.type === "FunctionDeclaration" && statement.id?.name === exported.name) return statement
    if (statement.type !== "VariableDeclaration") continue
    const declarator = statement.declarations.find((d) => d.id.type === "Identifier" && d.id.name === exported.name)
    if (declarator?.init) return declarator.init
  }
  return undefined
}

/** Why the engine may make an element any number of times: a callback, a condition, or a function that is not the circuit's own. */
function uncountedReason(ancestors: Node[], circuit: Node | undefined): string | undefined {
  if (isInsideCallback(ancestors)) return INSIDE_CALLBACK
  if (ancestors.some((node) => CONDITION_TYPES.has(node.type))) return INSIDE_CONDITION
  if (ancestors.some((node) => FUNCTION_TYPES.has(node.type) && node !== circuit)) return INSIDE_HELPER
  return undefined
}

function readElement(source: string, node: JSXElement, ancestors: Node[], circuit: Node | undefined): ElementFacts {
  const opening = node.openingElement
  const attributes = opening.attributes.filter((a): a is JSXAttribute => a.type === "JSXAttribute")
  const hasSpread = opening.attributes.some((a) => a.type === "JSXSpreadAttribute")
  const uncounted = uncountedReason(ancestors, circuit)
  const readonlyReason = uncounted === INSIDE_CALLBACK ? INSIDE_CALLBACK : hasSpread ? USES_SPREAD : undefined
  const parentElement = [...ancestors].reverse().find((a): a is JSXElement => a.type === "JSXElement")
  const page = enclosingPage(source, ancestors)
  return {
    tag: slice(source, opening.name),
    node,
    line: node.loc?.start.line ?? 0,
    start: node.start ?? 0,
    end: node.end ?? 0,
    attributes,
    props: readProps(source, attributes),
    ...(readonlyReason ? { readonlyReason } : {}),
    ...(parentElement ? { parent: slice(source, parentElement.openingElement.name) } : {}),
    ...(page === undefined ? {} : { page }),
    ...(uncounted ? { uncounted } : {}),
    hasSpread,
  }
}

/** The board's rectangle from literal width, height, pcbX and pcbY; undefined with an outline or a size not written as a literal. */
function boardBox(props: Record<string, PropInfo>): BoardBox | undefined {
  if (props["outline"] !== undefined) return undefined
  const length = (key: string, fallback?: number) => (props[key] === undefined ? fallback : parseLength(props[key]?.literal))
  const [width, height, x, y] = [length("width"), length("height"), length("pcbX", 0), length("pcbY", 0)]
  if (width === undefined || height === undefined || x === undefined || y === undefined) return undefined
  return { minX: x - width / 2, minY: y - height / 2, maxX: x + width / 2, maxY: y + height / 2 }
}

function collectElement(
  source: string,
  element: ElementFacts,
  ancestors: Node[],
  scan: Scan,
  found: { drawingTags: DrawingTag[]; boardTags: BoardItemTagFacts[]; named: NamedElement[] },
): void {
  if (element.tag === "board" || element.tag === "sheet") {
    // A sheet file's <sheet> holds its parts as a circuit's <board> does.
    const close = element.node.closingElement?.start
    if (close != null && scan.model.boardClose === undefined) scan.model.boardClose = { start: close }
    const box = element.tag === "board" ? boardBox(element.props) : undefined
    if (box && scan.model.boardBox === undefined) scan.model.boardBox = box
    if (element.tag === "sheet" && scan.sheetNode === undefined) scan.sheetNode = element.node
    return
  }
  if (element.tag === "page") return collectPage(element, scan)
  if (element.tag === "trace") return collectTrace(element, scan)
  if (isBoardItemTag(element.tag)) {
    const outline = element.attributes.find((a) => a.name.type === "JSXIdentifier" && a.name.name === "outline")
    const { tag, node, props, line, start, end, readonlyReason, parent, uncounted } = element
    found.boardTags.push({ tag, node, props, outlineValue: outline?.value, line, start, end, ...(readonlyReason ? { readonlyReason } : {}), ...(parent ? { parent } : {}), ...(uncounted ? { uncounted } : {}) })
    return
  }
  const kind = drawingKindOf(element.tag)
  if (kind) {
    found.drawingTags.push({ ...element, kind })
    return
  }
  const part = collectPart(element, scan)
  if (part) found.named.push({ name: part.name, tag: part.tag, uncounted: element.uncounted !== undefined })
}

function collectTrace(element: ElementFacts, scan: Scan): void {
  const { props, readonlyReason, attributes, parent, page } = element
  const from = props.from?.literal
  const to = props.to?.literal
  const literalEnds = typeof from === "string" && typeof to === "string"
  const reason = readonlyReason ?? (literalEnds ? undefined : "from or to is not a string literal")
  const trace: TraceInfo = {
    from: typeof from === "string" ? from : undefined,
    to: typeof to === "string" ? to : undefined,
    ...(parent === undefined ? {} : { parent }),
    ...(page === undefined ? {} : { page }),
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

/** A `<page>` holds parts; it is not one. */
function collectPage(element: ElementFacts, scan: Scan): void {
  const name = element.props.name?.literal
  const close = element.node.closingElement?.start
  scan.pageNodes.push(element.node)
  scan.model.pages?.push({
    name: typeof name === "string" ? name : undefined,
    line: element.line,
    start: element.start,
    end: element.end,
    ...(close == null ? {} : { closeStart: close }),
  })
}

/** The literal name of the nearest `<page>` around an element; none for the first page, "Main". */
function enclosingPage(source: string, ancestors: Node[]): string | undefined {
  const page = [...ancestors].reverse().find((a): a is JSXElement => a.type === "JSXElement" && slice(source, a.openingElement.name) === "page")
  const attribute = page?.openingElement.attributes.find((a): a is JSXAttribute => a.type === "JSXAttribute" && a.name.name === "name")
  const name = attribute ? readLiteral(attribute.value) : undefined
  return typeof name === "string" && name !== MAIN_PAGE ? name : undefined
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
    ...(element.parent === undefined ? {} : { parent: element.parent }),
    ...(element.page === undefined ? {} : { page: element.page }),
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
      // A literal point (a moved label's offset) is written back as a whole, so it is editable too.
      const editable = literal !== undefined || readPoint(attribute.value) !== undefined
      const info = { literal, source: attribute.value ? slice(source, attribute.value) : "", editable }
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
