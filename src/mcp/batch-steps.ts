// The edit_circuit steps for what the Studio writes and the older keys did not reach: drawings and text on a schematic
// page, text on the board's silkscreen (add_drawing with a layer; set_drawing and remove_drawing by its id), pages, a wire's corners, a sheet's ports and symbol size, and a pour's or hole's props after they exist. The
// tool's schema only says each is an object (the tool list is paid for on every turn); the exact shapes are here, and a
// wrong one is answered with the right one and an example (the guide's "Drawings, pages and corners" has the same).
import { z } from "zod"
import { isBoardGraphicId, isSilkTextId } from "../core/board-items.js"
import { nextDrawingName, type Edit } from "../core/index.js"
import type { CircuitModel, DrawingValue, Point } from "../core/types.js"
import { MAIN_PAGE } from "../engine/model.js"

const point = z.object({ x: z.number(), y: z.number() }).strict()
const points = z.array(point).min(2).max(1000)
const stroke = { strokeWidth: z.number().optional(), lineStyle: z.enum(["solid", "dashed", "dotted"]).optional(), color: z.string().optional() }
const at = { x: z.number(), y: z.number() }
const named = { page: z.string().optional(), name: z.string().optional() }

/** Each shape's own props, as the engine reads them (src/engine/drawings.ts). */
const SHAPES = {
  text: z.object({ shape: z.literal("text").optional(), text: z.string().min(1), ...at, fontSize: z.number().positive().optional(), anchor: z.enum(["left", "center", "right"]).optional(), color: z.string().optional(), ...named }).strict(),
  line: z.object({ shape: z.literal("line"), points, ...stroke, ...named }).strict(),
  rect: z.object({ shape: z.literal("rect"), ...at, width: z.number(), height: z.number(), filled: z.boolean().optional(), ...stroke, ...named }).strict(),
  circle: z.object({ shape: z.literal("circle"), ...at, radius: z.number(), filled: z.boolean().optional(), ...stroke, ...named }).strict(),
  arc: z.object({ shape: z.literal("arc"), ...at, radius: z.number(), startAngle: z.number(), endAngle: z.number(), ...stroke, ...named }).strict(),
  junction: z.object({ shape: z.literal("junction"), ...at, color: z.string().optional(), ...named }).strict(),
  bus: z.object({ shape: z.literal("bus"), name: z.string(), points, page: z.string().optional() }).strict(),
} as const
type Shape = keyof typeof SHAPES

/** Text on the board's silkscreen: add_drawing with a layer, in mm (src/engine/silk-text.ts has the limits). */
const SILK_TEXT = z
  .object({ shape: z.literal("text").optional(), text: z.string().min(1), ...at, layer: z.enum(["top", "bottom"]), height: z.number().optional(), rotation: z.number().optional(), name: z.string().optional() })
  .strict()

const TAGS: Record<Shape, string> = { text: "schematictext", line: "schematicpath", rect: "schematicrect", circle: "schematiccircle", arc: "schematicarc", junction: "junction", bus: "bus" }

/** The shape and one example of every new key; a refusal quotes it. */
export const STEP_SHAPES = {
  add_drawing:
    '{ shape?: "text" (default) | "line" | "rect" | "circle" | "arc" | "junction" | "bus", page?, name?, …its props }, e.g. { "text": "5 V in", "x": 2, "y": 1.5, "page": "Power" } or { "shape": "rect", "x": 0, "y": 0, "width": 3, "height": 2 }; text with a layer is board silkscreen in mm, e.g. { "text": "IO-8 v1", "x": 0, "y": 9, "layer": "top", "height": 1.5, "rotation": 0 }',

  set_drawing: '{ id, …props to change } (a name renames it), e.g. { "id": "G3", "x": 4, "text": "VBUS" }',
  remove_drawing: '{ id }, e.g. { "id": "G3" }',
  add_page: '{ name }, e.g. { "name": "Power" }',
  rename_page: '{ from, to }, e.g. { "from": "Page2", "to": "Power" }',
  remove_page: '{ name }, e.g. { "name": "Power" }',
  wire_corners: '{ from, to, corners: [{ x, y }, …] } ([] removes them), e.g. { "from": "R1.pin1", "to": "net.VBUS", "corners": [{ "x": 3, "y": 1 }] }',
  rename_parts: '{ OLD: "NEW", … } alone in its call, e.g. { "R7": "R1", "R1": "R7" }',
  rename_port: '{ from, to } in a sheet file, e.g. { "from": "VIN", "to": "VBUS" }',
  sheet_size: '{ width?, height? } in a sheet file (null: the ports decide), e.g. { "width": 4, "height": 3 }',
  set_pour: '{ id, net?, layer?, outline? (null: whole board), priority?, clearance?, minWidth?, thermal?, thermalWidth?, thermalGap? (null removes) }, e.g. { "id": "copperpour:1", "clearance": 0.4 }',
  set_hole: '{ id, x?, y?, diameter? } in mm, e.g. { "id": "hole:1", "diameter": 3.2 }',
} as const
export type StepKey = keyof typeof STEP_SHAPES
export const STEP_KEYS = Object.keys(STEP_SHAPES) as StepKey[]

/** Parses a step's value or throws what was wrong and the shape it takes. */
function parsed<T>(key: StepKey, schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : ""
  throw new Error(`${key} ${where}${issue?.message ?? "is not valid"}. It takes ${STEP_SHAPES[key]}`)
}

const ends = z.object({ from: z.string(), to: z.string() }).strict()
const idOnly = z.object({ id: z.string() }).strict()
const pageName = z.object({ name: z.string() }).strict()
const literalOrNull = z.union([z.string(), z.number(), z.boolean(), z.null()])

const without = <T extends Record<string, unknown>>(value: T, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(value).filter(([key, one]) => !keys.includes(key) && one !== undefined)) as Record<string, DrawingValue>

/** The names the batch's earlier steps give new drawings, so a second one in the same call takes the next G<n>. */
function nameFor(model: CircuitModel, earlier: readonly Edit[]): string {
  const added = earlier.flatMap((edit) => (edit.kind === "addDrawing" && edit.name ? [edit.name] : []))
  const highest = Math.max(Number(nextDrawingName(model).slice(1)) - 1, ...added.map((name) => Number(/^G(\d+)$/.exec(name)?.[1] ?? 0)))
  return `G${highest + 1}`
}

/** The pages there are: "Main", the file's, and those the batch's earlier steps make or name. */
function pagesOf(model: CircuitModel, earlier: readonly Edit[]): string[] {
  const made = earlier.flatMap((edit) => {
    if (edit.kind === "addPage") return [edit.name]
    if (edit.kind === "renamePage") return [edit.to]
    if (edit.kind === "movePartToPage") return [edit.page]
    return (edit.kind === "addPart" || edit.kind === "addTrace" || edit.kind === "addInstance") && edit.page ? [edit.page] : []
  })
  return [...new Set([MAIN_PAGE, ...(model.pages ?? []).flatMap((page) => (page.name ? [page.name] : [])), ...made])]
}

/** Refuses a page that does not exist, so a typo does not make one. */
function checkPage(page: string, model: CircuitModel, earlier: readonly Edit[]): void {
  const pages = pagesOf(model, earlier)
  if (!pages.includes(page)) throw new Error(`No schematic page "${page}"; the pages are ${pages.join(", ")}; add_page makes one`)
}

/** A text for the board's silkscreen: the core holds it to the engine's limits. */
function silkTextStep(value: unknown): Step {
  const { shape: _, ...step } = parsed("add_drawing", SILK_TEXT, value)
  const fields = Object.fromEntries(Object.entries(step).filter(([, one]) => one !== undefined)) as Omit<Extract<Edit, { kind: "addSilkText" }>, "kind">
  return { edit: { kind: "addSilkText", ...fields }, label: `add silkscreen text "${step.text.slice(0, 40)}" on the ${step.layer}` }
}

function drawingStep(value: unknown, model: CircuitModel, earlier: readonly Edit[]): { edit: Edit; label: string } {
  const raw = (value ?? {}) as { shape?: unknown; layer?: unknown }
  if (raw.layer !== undefined) return silkTextStep(value)
  const shape = (raw.shape ?? "text") as Shape
  if (!Object.hasOwn(SHAPES, shape)) throw new Error(`add_drawing shape must be one of ${Object.keys(SHAPES).join(", ")}. It takes ${STEP_SHAPES.add_drawing}`)
  const step = parsed("add_drawing", SHAPES[shape] as z.ZodType<Record<string, unknown>>, value)
  const name = typeof step["name"] === "string" ? step["name"] : nameFor(model, earlier)
  const page = typeof step["page"] === "string" ? step["page"] : undefined
  if (page !== undefined) checkPage(page, model, earlier)
  const edit: Edit = { kind: "addDrawing", tag: TAGS[shape], name, props: without(step, ["shape", "name", "page"]), ...(page ? { page } : {}) }
  return { edit, label: `add ${shape} ${name}${page ? ` on page ${page}` : ""}` }
}

const corners = z.object({ from: z.string(), to: z.string(), corners: z.array(point).max(1000) }).strict()
const renames = z.record(z.string(), z.string()).refine((map) => Object.keys(map).length > 0, "names no part")
const sheetSize = z.object({ width: z.number().nullable().optional(), height: z.number().nullable().optional() }).strict()
const pourChange = z.object({ id: z.string() }).catchall(z.union([literalOrNull, z.array(point)]))
const holeChange = z.object({ id: z.string(), x: z.number().optional(), y: z.number().optional(), diameter: z.number().optional() }).strict()

/** The rename a rename_parts step asks for, as the core's mapping. */
export function renameMapping(value: unknown): { from: string; to: string }[] {
  const pairs = Object.entries(parsed("rename_parts", renames, value)).map(([from, to]) => ({ from, to }))
  const changed = pairs.filter(({ from, to }) => from !== to)
  if (changed.length === 0) throw new Error(`${pairs.map(({ from }) => from).join(", ")} already ${pairs.length === 1 ? "has" : "have"} that name; nothing was written`)
  return changed
}

type Step = { edit: Edit; label: string }

function setDrawingStep(value: unknown): Step {
  const { id, ...props } = parsed("set_drawing", z.object({ id: z.string() }).catchall(z.union([z.string(), z.number(), z.boolean(), z.array(point), z.null()])), value)
  if (Object.keys(props).length === 0) throw new Error(`set_drawing names nothing to change. It takes ${STEP_SHAPES.set_drawing}`)
  if (isSilkTextId(id) || isBoardGraphicId(id)) {
    const literal = Object.entries(props).find(([, one]) => Array.isArray(one))
    const takes = isSilkTextId(id) ? "a silkscreen text takes text, x, y, layer, height, rotation and name" : "a board drawing takes file, layer, net, x, y, width, scale, rotation, fill and name"
    if (literal) throw new Error(`set_drawing ${literal[0]}: ${takes}`)
    const kind = isSilkTextId(id) ? "setSilkText" : "setBoardGraphic"
    return { edit: { kind, id, props: props as Record<string, string | number | boolean | null> }, label: `set ${id} ${Object.keys(props).join(",")}` }
  }
  if (Object.values(props).includes(null)) throw new Error(`set_drawing: null removes a prop of a silkscreen text or board drawing only. It takes ${STEP_SHAPES.set_drawing}`)
  return { edit: { kind: "setDrawingProps", id, props: props as Record<string, DrawingValue> }, label: `set ${id} ${Object.keys(props).join(",")}` }
}

function drawingSteps(key: "add_drawing" | "set_drawing" | "remove_drawing", value: unknown, model: CircuitModel, earlier: readonly Edit[]): Step {
  if (key === "add_drawing") return drawingStep(value, model, earlier)
  if (key === "set_drawing") return setDrawingStep(value)
  const { id } = parsed(key, idOnly, value)
  const edit: Edit = isSilkTextId(id) ? { kind: "removeSilkText", id } : isBoardGraphicId(id) ? { kind: "removeBoardGraphic", id } : { kind: "removeDrawing", id }
  return { edit, label: `remove ${id}` }
}

function pageSteps(key: "add_page" | "rename_page" | "remove_page", value: unknown): Step {
  if (key === "rename_page") {
    const { from, to } = parsed(key, ends, value)
    return { edit: { kind: "renamePage", from, to }, label: `rename page ${from} to ${to}` }
  }
  const { name } = parsed(key, pageName, value)
  return key === "add_page" ? { edit: { kind: "addPage", name }, label: `add page ${name}` } : { edit: { kind: "removePage", name }, label: `remove page ${name}` }
}

function wireStep(value: unknown): Step {
  const step = parsed("wire_corners", corners, value)
  const words = step.corners.length === 0 ? "straight" : `${step.corners.length} corner${step.corners.length === 1 ? "" : "s"}`
  return { edit: { kind: "setTraceHints", from: step.from, to: step.to, schematicRouteHints: step.corners }, label: `wire ${step.from} -> ${step.to} ${words}` }
}

function sheetSteps(key: "rename_port" | "sheet_size", value: unknown): Step {
  if (key === "rename_port") {
    const { from, to } = parsed(key, ends, value)
    return { edit: { kind: "renamePort", from, to }, label: `rename port ${from} to ${to}` }
  }
  const size = parsed(key, sheetSize, value)
  if (size.width === undefined && size.height === undefined) throw new Error(`sheet_size names nothing to change. It takes ${STEP_SHAPES.sheet_size}`)
  return { edit: { kind: "setSheetSize", ...size }, label: `sheet size ${size.width ?? "-"} x ${size.height ?? "-"}` }
}

function boardItemSteps(key: "set_pour" | "set_hole", value: unknown): Step {
  if (key === "set_pour") {
    const { id, ...props } = parsed(key, pourChange, value)
    if (Object.keys(props).length === 0) throw new Error(`set_pour names nothing to change. It takes ${STEP_SHAPES.set_pour}`)
    return { edit: { kind: "setPour", id, props: props as Record<string, string | number | boolean | Point[] | null> }, label: `set ${id} ${Object.keys(props).join(",")}` }
  }
  const { id, ...rest } = parsed(key, holeChange, value)
  const props = Object.fromEntries(Object.entries(rest).filter(([, one]) => one !== undefined)) as Record<string, number>
  if (Object.keys(props).length === 0) throw new Error(`set_hole names nothing to change. It takes ${STEP_SHAPES.set_hole}`)
  return { edit: { kind: "setHole", id, props }, label: `set ${id} ${Object.keys(props).join(",")}` }
}

/** Turns one of the newer steps into the core's edit and the words the answer uses for it. */
export function stepEdit(key: StepKey, value: unknown, model: CircuitModel, earlier: readonly Edit[]): Step {
  switch (key) {
    case "add_drawing":
    case "set_drawing":
    case "remove_drawing":
      return drawingSteps(key, value, model, earlier)
    case "add_page":
    case "rename_page":
    case "remove_page":
      return pageSteps(key, value)
    case "wire_corners":
      return wireStep(value)
    case "rename_parts":
      throw new Error(`rename_parts goes alone in its edit_circuit call (it also renames the copper's nets). It takes ${STEP_SHAPES.rename_parts}`)
    case "rename_port":
    case "sheet_size":
      return sheetSteps(key, value)
    case "set_pour":
    case "set_hole":
      return boardItemSteps(key, value)
  }
}

/** connect's optional corners: a hand-drawn wire with these corners, as the Studio's net labels are written. */
export function connectCorners(value: unknown): Point[] | undefined {
  if (value === undefined) return undefined
  const result = z.array(point).min(1).max(1000).safeParse(value)
  if (!result.success) throw new Error(`connect corners must be a list of { x, y }, e.g. [{ "x": 3, "y": 1 }]`)
  return result.data
}
