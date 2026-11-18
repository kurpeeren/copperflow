// File → Import a drawing (SVG or DXF)…: the dialog's state as plain data. The picked file is read by the engine's own
// reader (pure, so it runs in the browser), which gives its size and what it left out; the form then holds the layer,
// the width (the height follows the drawing's shape), whether to fill closed outlines and a name, and Import sends the
// request the server's /api/import-graphic takes. The drawing lands at the board's centre. Pure; plain TypeScript with
// .js imports, so the tests run it.
import { ALL_LIGHT_NOTE, graphicKind, parseGraphic, type GraphicShapes } from "../../../src/engine/graphics/index.js"

export { cachedPreview, graphicPreview, type GraphicPreview } from "./graphic-preview.js"

export const GRAPHIC_LAYERS = ["top-silkscreen", "bottom-silkscreen", "top-mask", "bottom-mask", "top", "bottom", "inner1", "inner2"] as const
export type GraphicLayerChoice = (typeof GRAPHIC_LAYERS)[number]

/** What each layer does to the drawing, as the layer list says it. */
const LAYER_LABELS: Readonly<Record<GraphicLayerChoice, string>> = {
  "top-silkscreen": "Top silkscreen: ink",
  "bottom-silkscreen": "Bottom silkscreen: ink",
  "top-mask": "Top solder mask: an opening",
  "bottom-mask": "Bottom solder mask: an opening",
  top: "Top copper",
  bottom: "Bottom copper",
  inner1: "Inner copper 1",
  inner2: "Inner copper 2",
}
const COPPER: ReadonlySet<GraphicLayerChoice> = new Set(["top", "bottom", "inner1", "inner2"])
const INNER: ReadonlySet<GraphicLayerChoice> = new Set(["inner1", "inner2"])
const FOUR_LAYERS = 4

/** The largest drawing the Studio sends; the server takes requests up to 1 MB. */
export const MAX_DRAWING_BYTES = 1000 * 1000
/** The longest name a drawing may carry, in characters. */
const MAX_NAME = 100
/** Sizes are shown and prefilled to a micrometre. */
const DIGITS = 1e3

export interface GraphicImportRequest {
  /** The file's name, which says whether it is an SVG or a DXF. */
  name: string
  text: string
  layer: GraphicLayerChoice
  width?: number
  fill?: boolean
  /** The drawing's own name, written on the `<boardgraphic>`. */
  title?: string
  /** On copper, the net the drawing is part of. */
  net?: string
}

/** A file read: its name, its text and the reader's shapes. */
export interface PickedDrawing {
  name: string
  text: string
  shapes: GraphicShapes
}

export interface GraphicForm {
  layer: GraphicLayerChoice
  /** The width in mm as typed. */
  width: string
  fill: boolean
  name: string
  /** The chosen net by name; empty for no net. Sent only for a copper layer. */
  net: string
}

const mm = (value: number): string => String(Math.round(value * DIGITS) / DIGITS)

/** The layers a drawing can go on, with what each does; the inner copper layers only on a 4-layer board. */
export function graphicLayerChoices(boardLayers: number): { id: GraphicLayerChoice; label: string }[] {
  return GRAPHIC_LAYERS.filter((id) => boardLayers === FOUR_LAYERS || !INNER.has(id)).map((id) => ({ id, label: LAYER_LABELS[id] }))
}

/** Why a file cannot be imported, known before its text is read: not an SVG or DXF, or larger than 1 MB. */
export function fileProblem(name: string, bytes: number): string | undefined {
  if (!graphicKind(name)) return "Choose an SVG or DXF file"
  return bytes > MAX_DRAWING_BYTES ? `${name} is larger than 1 MB; put it in the project and import it with copperflow graphic` : undefined
}

/** The picked file read into shapes, or why it cannot be imported. */
export function readPickedDrawing(name: string, text: string, bytes = 0): PickedDrawing | { message: string } {
  const problem = fileProblem(name, bytes)
  if (problem) return { message: problem }
  const kind = graphicKind(name) as NonNullable<ReturnType<typeof graphicKind>>
  const shapes = parseGraphic(text, kind)
  if ("error" in shapes) return { message: shapes.error }
  if (shapes.fills.length === 0 && shapes.strokes.length === 0) return { message: `${name} has nothing to draw` }
  return { name, text, shapes }
}

/** "20 × 10 mm": the drawing's size as the reader gives it. */
export const sizeLine = (shapes: GraphicShapes): string => `${mm(shapes.width)} × ${mm(shapes.height)} mm`

/** "Left out: 2 text elements", or undefined when the reader kept everything. */
export function skippedLine(shapes: GraphicShapes): string | undefined {
  // The reader's notes are what it left out, but for one: a drawing of light shapes only, which it draws as ink.
  const left = shapes.skipped.filter((note) => note !== ALL_LIGHT_NOTE)
  const parts = [...(left.length < shapes.skipped.length ? ["No dark shape, so the light shapes are drawn as ink."] : []), ...(left.length === 0 ? [] : [`Left out: ${left.join(", ")}`])]
  return parts.length === 0 ? undefined : parts.join(" ")
}

/** Fill closed outlines is offered only for a drawing with closed lines, which are drawn as lines unless filled. */
export const showsFill = (shapes: GraphicShapes): boolean => shapes.strokes.some((stroke) => stroke.closed)

/** The form for a file just read: the top silkscreen, the drawing's own width, no fill, named after the file. */
export function startForm(picked: PickedDrawing): GraphicForm {
  return { layer: "top-silkscreen", width: mm(picked.shapes.width), fill: false, name: picked.name.replace(/\.[^.]+$/, ""), net: "" }
}

/** The net field shows only for a copper layer. */
export const showsNet = (layer: GraphicLayerChoice): boolean => COPPER.has(layer)

/** What the net field says a net does. */
export const NET_NOTE = "On a net the drawing is that net's copper and joins what it touches; with no net every net keeps clear of it."

/** The net choices: "No net" first, then the circuit's nets by first name, as the inspector's Net row lists them. */
export function graphicNetChoices(nets: readonly { names: readonly string[] }[]): { value: string; label: string }[] {
  return [{ value: "", label: "No net" }, ...nets.flatMap((net) => (net.names[0] ? [{ value: net.names[0], label: net.names[0] }] : []))]
}

/** The width typed as mm above 0, or undefined. */
function widthOf(text: string): number | undefined {
  const value = Number(text.trim())
  return text.trim() !== "" && Number.isFinite(value) && value > 0 ? value : undefined
}

/** The height that keeps the drawing's shape at the typed width, or undefined while the width is not a number. */
export function keptHeight(shapes: GraphicShapes, width: string): string | undefined {
  const value = widthOf(width)
  return value === undefined || shapes.width <= 0 ? undefined : mm((value * shapes.height) / shapes.width)
}

const WIDTH_PROBLEM = "The width must be a number of mm above 0"
const NAME_PROBLEM = `The name must be at most ${MAX_NAME} characters`

/** What is wrong with each field, by field; empty while the form is valid. */
export function fieldProblems(picked: PickedDrawing, form: GraphicForm): { width?: string; name?: string } {
  return { ...(widthOf(form.width) === undefined ? { width: WIDTH_PROBLEM } : {}), ...(form.name.trim().length > MAX_NAME ? { name: NAME_PROBLEM } : {}) }
}

/**
 * What Import sends for the file and the form, or why the form is not ready. `nets` are the circuit's net names now:
 * a chosen net no longer among them is not sent.
 */
export function graphicImportRequest(picked: PickedDrawing, form: GraphicForm, nets?: readonly string[]): GraphicImportRequest | { message: string } {
  const problems = fieldProblems(picked, form)
  const message = problems.width ?? problems.name
  if (message !== undefined) return { message }
  const width = widthOf(form.width) as number
  const title = form.name.trim()
  const net = showsNet(form.layer) && form.net !== "" && (nets === undefined || nets.includes(form.net)) ? form.net : undefined
  return {
    name: picked.name,
    text: picked.text,
    layer: form.layer,
    width,
    ...(form.fill && showsFill(picked.shapes) ? { fill: true } : {}),
    ...(title === "" ? {} : { title }),
    ...(net === undefined ? {} : { net }),
  }
}

/**
 * After Import: the dialog closes when the drawing was placed; a refusal stays in it, in the server's words. A dialog
 * already closed (`open` false) is left alone, so another dialog open by then is not closed.
 */
export function afterImport(outcome: { ok: boolean; refusal?: string }, open = true): { close: true } | { close: false; problem?: string } {
  if (!open) return { close: false }
  if (outcome.ok) return { close: true }
  return { close: false, problem: outcome.refusal ?? "The drawing was not imported; see the status line" }
}

/** Numbers the file reads, so a read that finishes after a later one is dropped. */
export function latestOnly(): { next(): number; isLatest(read: number): boolean } {
  let last = 0
  return { next: () => ++last, isLatest: (read) => read === last }
}

/** The circuit's net names, as the net field lists them. */
export const netNames = (nets: readonly { names: readonly string[] }[]): string[] => graphicNetChoices(nets).flatMap((choice) => (choice.value === "" ? [] : [choice.value]))
