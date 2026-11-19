// The board's own silkscreen texts on the PCB canvas: the same strokes the Gerber legend files carry
// (fab/silk-text-strokes.ts), in the side's silk colour and line width; a selected one is ringed, a dragged one is drawn
// where it is going. Drawn in world units, under the canvas's world transform.
import { silkTextBox, silkTextLineWidth, silkTextStrokes } from "../../../src/engine/fab/silk-text-strokes.js"
import type { SilkText } from "../../../src/engine/model.js"
import { PALETTE, type Ctx } from "./ctx.js"
import type { Point } from "./geometry.js"
import type { LayerVisibility } from "./layers.js"

/** Which texts are selected or hovered, and the one being dragged with how far it has moved, in mm. */
export interface SilkTextScene {
  selected: ReadonlySet<string>
  hovered?: string
  moving?: { id: string; by: Point }
}

/** How far the selection ring stands off the text's ink, in CSS pixels. */
const RING_GAP_PX = 3
const RING_PX = 1.5
/** A hovered text's ring is fainter than a selected one's. */
const HOVER_ALPHA = 0.5

const shown = (layers: LayerVisibility, text: SilkText) => layers[text.layer === "top" ? "topSilk" : "bottomSilk"]

/** The text where the canvas shows it: moved by a drag in progress. */
export function shownText(text: SilkText, scene: SilkTextScene | undefined): SilkText {
  const moving = scene?.moving
  return moving && moving.id === text.id ? { ...text, x: text.x + moving.by.x, y: text.y + moving.by.y } : text
}

/** Draws every text whose silk layer is shown; `px` is one CSS pixel in mm. */
export function drawSilkTexts(ctx: Ctx, texts: readonly SilkText[], layers: LayerVisibility, scene: SilkTextScene | undefined, px: number): void {
  for (const original of texts) {
    if (!shown(layers, original)) continue
    const text = shownText(original, scene)
    const colour = text.layer === "top" ? PALETTE.topSilk : PALETTE.bottomSilk
    ctx.strokeStyle = colour
    ctx.fillStyle = colour
    ctx.lineWidth = silkTextLineWidth(text.height)
    for (const line of silkTextStrokes(text)) strokeLine(ctx, line)
    if (scene?.selected.has(text.id) || scene?.hovered === text.id) ring(ctx, text, scene.selected.has(text.id), px)
  }
}

/**
 * One stroke of a glyph; a dot (a stroke that starts and ends where it began, as "." and "i" have) is filled as a round
 * spot of the line's width, since a canvas draws nothing for a path of no length.
 */
export function strokeLine(ctx: Ctx, line: readonly Point[]): void {
  const first = line[0]
  if (!first || line.length < 2) return
  ctx.beginPath()
  if (line.every((p) => p.x === first.x && p.y === first.y)) {
    ctx.arc(first.x, first.y, ctx.lineWidth / 2, 0, 2 * Math.PI)
    ctx.fill()
    return
  }
  line.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.stroke()
}

function ring(ctx: Ctx, text: SilkText, selected: boolean, px: number): void {
  const box = silkTextBox(text)
  const gap = RING_GAP_PX * px
  ctx.save()
  ctx.strokeStyle = PALETTE.selection
  ctx.globalAlpha = selected ? 1 : HOVER_ALPHA
  ctx.lineWidth = RING_PX * px
  const [left, right, bottom, top] = [box.minX - gap, box.maxX + gap, box.minY - gap, box.maxY + gap]
  ctx.beginPath()
  ctx.moveTo(left, bottom)
  ctx.lineTo(right, bottom)
  ctx.lineTo(right, top)
  ctx.lineTo(left, top)
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

/** The text under a point (mm), topmost first: within its ink box grown by `slack` mm; only texts on shown layers. */
export function silkTextAt(texts: readonly SilkText[], p: Point, layers: LayerVisibility, slack: number): SilkText | undefined {
  for (const text of [...texts].reverse()) {
    if (!shown(layers, text)) continue
    const box = silkTextBox(text)
    if (p.x >= box.minX - slack && p.x <= box.maxX + slack && p.y >= box.minY - slack && p.y <= box.maxY + slack) return text
  }
  return undefined
}
