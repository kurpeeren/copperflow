import { readFileSync } from "node:fs"
import { labelTag, NET_LABEL_TEXT, TAG_CHAR } from "../studio/src/pcb/label-tag.js"
import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { CANVAS_FONT_FAMILY, CANVAS_MONO_FAMILY, UI_FONT_STACK } from "../studio/src/pcb/ctx.js"
import { drawPcb } from "../studio/src/pcb/pcb-draw.js"
import { drawSchematic } from "../studio/src/pcb/schematic-draw.js"

const read = (name: string) => readFileSync(new URL(`../studio/src/${name}`, import.meta.url), "utf8")
const STACK = '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif'
const MONO = '"Cascadia Mono", "JetBrains Mono", ui-monospace, Consolas, monospace'

describe("the interface's type", () => {
  test("the text stack is the one this round names, in the style sheet and on the canvases", () => {
    expect(UI_FONT_STACK).toBe(STACK)
    expect(CANVAS_FONT_FAMILY).toBe(STACK)
    expect(read("styles.css")).toContain(`--sans: ${STACK};`)
  })

  test("the mono stack stays, for code, ids and the schematic's pin numbers", () => {
    expect(CANVAS_MONO_FAMILY).toBe(MONO)
    expect(read("styles.css")).toContain(`--mono: ${MONO};`)
  })

  test("numbers line up: the body uses tabular figures and the inputs inherit them", () => {
    const styles = read("styles.css")
    // `html body` outranks styles.css's `body { font: … }`, whose shorthand would reset the figures to normal.
    expect(read("shell/shell.css")).toMatch(/html body [{][^}]*font-variant-numeric: tabular-nums;/)
    expect(styles).not.toContain("tabular-nums")
    expect(styles).toMatch(/button,\s*input,\s*select \{\s*font: inherit;/)
  })

  test("Properties values are 13px, like all panel text; table cells are 12px", () => {
    expect(read("inspector.css")).toMatch(/\.insp-value input:not\(\[type="checkbox"\]\)[^{]*\{[^}]*font-size: 13px;/)
    expect(read("library-table.css")).toMatch(/\.lib-table td \{[^}]*font-size: 12px;/)
  })
})

/** The fonts that fillText was called with, by text. */
function fontsOf(draw: (ctx: CanvasRenderingContext2D) => void): Map<string, string> {
  const state: Record<string, unknown> = { font: "" }
  const seen = new Map<string, string>()
  const ctx = new Proxy(state, {
    get: (target, key: string) => (key in target ? target[key] : key === "fillText" ? (text: string) => void seen.set(text, String(target.font)) : () => ({ width: 10 })),
    set: (target, key: string, value) => ((target[key] = value), true),
  }) as unknown as CanvasRenderingContext2D
  draw(ctx)
  return seen
}

const CIRCUIT = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={3} schY={0} />
    <trace from=".R1 > .pin1" to="net.GND" />
    <trace from=".R2 > .pin1" to="net.GND" />
    <trace from=".R1 > .pin2" to="net.EN" schematicRouteHints={[{ x: 1, y: 1 }]} />
  </board>
)`
const design = buildDesign({ "main.circuit.tsx": CIRCUIT }, "main.circuit.tsx")
const SIZE = { width: 800, height: 600 }

describe("canvas text weights", () => {
  const sheet = fontsOf((ctx) => drawSchematic(ctx as never, design.schematic, { camera: { cx: 1.5, cy: 0, scale: 100 }, size: SIZE }, { ratio: 1 }))

  test("schematic designators and net names are 600; values are 400", () => {
    expect(sheet.get("R1")).toMatch(/^600 [\d.]+px /)
    expect(sheet.get("EN")).toMatch(/^600 [\d.]+px /)
    expect(sheet.get("1k")).toMatch(/^400 [\d.]+px /)
  })

  test("schematic pin numbers are in the mono family; designators are not", () => {
    expect(sheet.get("1")).toMatch(/^400 [\d.]+px "Cascadia Mono"/)
    expect(sheet.get("R1")?.endsWith(STACK)).toBe(true)
  })

  test("PCB designators are 600", () => {
    const pcb = fontsOf((ctx) => drawPcb(ctx as never, design.pcb, { camera: { cx: 0, cy: 0, scale: 20 }, size: SIZE }, { ratio: 1 }))
    expect(pcb.get("R1")).toMatch(/^600 [\d.]+px /)
  })
})

describe("net label tags", () => {
  test("a tag leaves room for semibold text: 0.66 of the text height per character plus the tag's ends", () => {
    expect(TAG_CHAR).toBe(0.66)
    const tag = labelTag({ at: { x: 0, y: 0 }, side: "right", text: "VCC_3V3_ANALOG" })
    const width = tag.box.maxX - tag.box.minX
    expect(width).toBeCloseTo(14 * NET_LABEL_TEXT * 0.66 + NET_LABEL_TEXT * 1.5, 9)
  })
})
