import { readFileSync } from "node:fs"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { ICONS, type IconName } from "../studio/src/icon-shapes.js"
import { iconSvg } from "../studio/src/icon-svg.js"
import { TOOLBARS } from "../studio/src/shell/toolbar.js"

const read = (name: string) => readFileSync(new URL(`../studio/src/${name}`, import.meta.url), "utf8")
const NAMES = Object.keys(ICONS) as IconName[]
const markup = (name: IconName) => renderToStaticMarkup(iconSvg(name))
/** The numbers in a shape's attributes and path data. */
const numbers = (svg: string) => [...svg.replace(/<svg[^>]*>/, "").matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]))

describe("the icon set", () => {
  test("every icon is a 16px square on the 16-unit grid", () => {
    for (const name of NAMES) {
      const svg = markup(name)
      expect([name, /^<svg [^>]*viewBox="0 0 16 16"/.test(svg), /^<svg [^>]*width="16" height="16"/.test(svg)]).toEqual([name, true, true])
    }
  })

  test("every icon strokes 1.5px lines in the text colour, with round caps and joins, drawn for precision", () => {
    for (const name of NAMES) {
      const svg = markup(name)
      const root = /^<svg [^>]*>/.exec(svg)?.[0] ?? ""
      expect([name, root]).toEqual([name, expect.stringContaining('stroke-width="1.5"')])
      for (const attr of ['stroke="currentColor"', 'stroke-linecap="round"', 'stroke-linejoin="round"', 'fill="none"', 'shape-rendering="geometricPrecision"']) {
        expect([name, root.includes(attr)]).toEqual([name, true])
      }
      // No shape changes the line width; a filled glyph turns its stroke off instead.
      expect([name, svg.slice(root.length).includes("stroke-width")]).toEqual([name, false])
    }
  })

  test("every shape sits on a half-unit grid inside the 16 square", () => {
    for (const name of NAMES) {
      for (const n of numbers(markup(name))) expect([name, n, Number.isInteger(n * 2)]).toEqual([name, n, true])
      for (const shape of ICONS[name]) {
        if (shape.tag === "rect") expect([name, shape.x >= 0.5 && shape.y >= 0.5 && shape.x + shape.width <= 15.5 && shape.y + shape.height <= 15.5]).toEqual([name, true])
        if (shape.tag === "circle") expect([name, shape.cx - shape.r >= 0.5 && shape.cx + shape.r <= 15.5 && shape.cy - shape.r >= 0.5 && shape.cy + shape.r <= 15.5]).toEqual([name, true])
      }
    }
  })

  test("a filled shape fills in the text colour and draws no stroke", () => {
    const filled = NAMES.flatMap((name) => ICONS[name].filter((shape) => "fill" in shape && shape.fill).map(() => name))
    expect(new Set(filled)).toEqual(new Set(["fitSelection", "grid"]))
    expect(markup("grid")).toContain('fill="currentColor" stroke="none"')
  })

  test("props reach the svg: a class name, and a size override", () => {
    const svg = renderToStaticMarkup(iconSvg("chevron", { className: "insp-chevron" }))
    expect(svg).toMatch(/^<svg [^>]*class="insp-chevron"/)
    expect(svg).toContain('aria-hidden="true"')
  })
})

describe("the icons in use", () => {
  test("every toolbar button's icon is in the set", () => {
    const used = Object.values(TOOLBARS).flatMap((buttons) => buttons.flatMap((button) => (button.icon ? [button.icon] : [])))
    for (const name of used) expect([name, name in ICONS]).toEqual([name, true])
  })

  test("every icon component icons.tsx exports draws a name in the set, and the components the panels import exist", () => {
    const source = read("icons.tsx")
    const drawn = [...source.matchAll(/iconSvg\("(\w+)"/g)].map((m) => m[1] ?? "")
    expect(drawn.length).toBeGreaterThan(0)
    for (const name of drawn) expect([name, name in ICONS]).toEqual([name, true])
    const files = ["FindBox.tsx", "HistoryList.tsx", "Inspector.tsx", "InspectorDrawing.tsx", "InspectorGroup.tsx", "InspectorLabel.tsx", "InspectorRows.tsx", "InspectorWire.tsx", "LeftPanel.tsx", "shell/Dialogs.tsx", "shell/LayerPanel.tsx"]
    const imported = new Set(files.flatMap((file) => [.../import \{([^}]+)\} from "(?:\.\.\/|\.\/)icons"/.exec(read(file))?.[1]?.split(",") ?? []].map((n) => n.trim())))
    for (const name of imported) expect([name, new RegExp(`export const ${name} =`).test(source)]).toEqual([name, true])
  })

  test("the toolbar draws its icons through the same set", () => {
    const source = read("icons.tsx")
    expect(source).toMatch(/export const TOOL_ICONS: Record<ToolIconName, /)
    expect(source).not.toContain("viewBox")
  })
})

/** The declarations of the first rule with exactly this selector in `css`, or "". */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`)
  return at < 0 ? "" : css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at))
}

describe("toolbar buttons", () => {
  const css = () => read("shell/toolbar.css")

  test("are 24px squares with the icon centred, in a 32px row", () => {
    const button = rule(css(), ".toolbar-button")
    for (const decl of ["width: 24px;", "height: 24px;", "display: grid;", "place-items: center;", "padding: 0;"]) expect([decl, button.includes(decl)]).toEqual([decl, true])
    expect(rule(css(), ".studio-toolbar")).toContain("height: 32px;")
  })

  test("pressed is the copper wash with a copper icon, hovered or not", () => {
    for (const selector of ['button.toolbar-button[aria-pressed="true"]', 'button.toolbar-button[aria-pressed="true"]:hover:not(:disabled)']) {
      const block = rule(css(), selector)
      expect([selector, block.includes("background: var(--copper-wash);"), block.includes("color: var(--copper);")]).toEqual([selector, true, true])
    }
  })

  test("disabled is the disabled grey, not a faded icon, with no hover or pressed fill", () => {
    const block = rule(css(), 'button.toolbar-button[aria-disabled="true"]')
    expect(block).toContain("color: var(--disabled);")
    expect(block).not.toContain("opacity")
    expect(rule(css(), 'button.toolbar-button[aria-disabled="true"]:hover,\nbutton.toolbar-button[aria-disabled="true"]:active')).toContain("background: transparent;")
  })

  test("hover and press change colour over 120ms", () => {
    expect(rule(css(), ".toolbar-button")).toContain("transition: background-color var(--ease), color var(--ease);")
  })
})
