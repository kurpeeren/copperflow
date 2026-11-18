// The board's own words on the silkscreen (`<silkscreentext text x y layer height rotation name />`): the limits a
// person or an agent is held to, shared by the build (which warns and leaves a bad one out) and the core's edits
// (which refuse it). Pure.
import { pcbPoint, type Offset } from "./component.js"
import { diagnostic } from "./diagnostics.js"
import { DRAWABLE_CHARACTERS, undrawable } from "./fab/stroke-font.js"
import type { Diagnostic, SilkText, SourceRef } from "./model.js"
import { PropReader, type Props } from "./read-props.js"

export const SILK_TEXT_TAG = "silkscreentext"
/**
 * The smallest character height a board house typically prints legibly with a 0.15 mm line, in mm (a typical figure
 * from common fabrication guidelines, not a citation; the fabrication profiles in rules/ set no silkscreen height).
 */
export const MIN_SILK_TEXT_HEIGHT = 0.8
/** The tallest text taken, in mm: anything larger is a slip, not a legend. */
export const MAX_SILK_TEXT_HEIGHT = 20
/** The height a text gets when none is written, in mm. */
export const DEFAULT_SILK_TEXT_HEIGHT = 1.5
/** The longest text taken, in characters: one line of a legend. */
export const MAX_SILK_TEXT_LENGTH = 100
export const SILK_TEXT_LAYERS = ["top", "bottom"] as const

/** A silkscreen text's id: "silkscreentext:1", or inside a sub-sheet instance its path first. */
export const silkTextId = (index: number, instance: string | undefined): string =>
  instance === undefined ? `${SILK_TEXT_TAG}:${index}` : `${instance}/${SILK_TEXT_TAG}:${index}`

/** What is wrong with the words, or undefined when the lettering can draw them. */
export function silkWordsProblem(text: unknown): string | undefined {
  if (typeof text !== "string" || text.trim() === "") return "text must be some words, not empty"
  if ([...text].length > MAX_SILK_TEXT_LENGTH) return `text must be at most ${MAX_SILK_TEXT_LENGTH} characters`
  if (/[\r\n\t]/.test(text)) return "text must be one line; add a second text for a second line"
  const missing = undrawable(text)
  if (missing.length > 0) return `the silkscreen lettering cannot draw ${missing.map((c) => `"${c}"`).join(" ")}; it draws ${DRAWABLE_CHARACTERS}`
  return undefined
}

/** What is wrong with the height, or undefined when a board house can print it. */
export function silkHeightProblem(height: unknown): string | undefined {
  if (typeof height !== "number" || !Number.isFinite(height)) return "height must be a number of mm"
  if (height < MIN_SILK_TEXT_HEIGHT) return `height must be at least ${MIN_SILK_TEXT_HEIGHT} mm, the smallest text a board house prints legibly`
  if (height > MAX_SILK_TEXT_HEIGHT) return `height must be at most ${MAX_SILK_TEXT_HEIGHT} mm`
  return undefined
}

/** What is wrong with the side, or undefined. */
export function silkLayerProblem(layer: unknown): string | undefined {
  return (SILK_TEXT_LAYERS as readonly unknown[]).includes(layer) ? undefined : 'layer must be "top" or "bottom"'
}

interface Origin {
  offset: Offset
  index: number
  source: SourceRef
  instance?: string | undefined
}

/**
 * One `<silkscreentext>`: its words centred on x, y (shifted and turned by the groups), on the top side unless
 * `layer="bottom"`, DEFAULT_SILK_TEXT_HEIGHT tall unless `height` says, turned `rotation` degrees. A text without a
 * position, or one breaking a limit, is warned about with the reason and left out.
 */
export function buildSilkText(props: Props, origin: Origin): { text?: SilkText; diagnostics: Diagnostic[] } {
  const id = silkTextId(origin.index, origin.instance)
  const reader = new PropReader(props, SILK_TEXT_TAG, origin.source)
  const [x, y] = [reader.length("x"), reader.length("y")]
  const height = props["height"] === undefined ? DEFAULT_SILK_TEXT_HEIGHT : reader.length("height")
  const rotation = props["rotation"] === undefined ? 0 : reader.angle("rotation")
  const layer = props["layer"] ?? "top"
  const name = reader.string("name")
  const problem =
    x === undefined || y === undefined
      ? "needs x and y"
      : (silkWordsProblem(props["text"]) ?? silkLayerProblem(layer) ?? (height === undefined ? undefined : silkHeightProblem(height)))
  const extra = problem === undefined ? [] : [diagnostic("bad-value", "warning", `${SILK_TEXT_TAG} ${id}: ${problem}; it is ignored`, [id], origin.source)]
  const diagnostics = [...reader.diagnostics, ...extra]
  if (problem !== undefined || x === undefined || y === undefined || height === undefined || rotation === undefined) return { diagnostics }
  const at = pcbPoint(origin.offset, x, y)
  const turned = rotation + (origin.offset.pcbRotation ?? 0)
  const text: SilkText = {
    id,
    text: props["text"] as string,
    x: at.x,
    y: at.y,
    layer: layer as SilkText["layer"],
    height,
    rotation: turned,
    ...(name === undefined ? {} : { name }),
    source: origin.source,
  }
  return { text, diagnostics }
}
