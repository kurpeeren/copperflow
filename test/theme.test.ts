import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { contrastRatio } from "../studio/src/shell/contrast.js"
import { dprStyle, watchDpr } from "../studio/src/shell/dpr.js"

const SRC = fileURLToPath(new URL("../studio/src/", import.meta.url))
const read = (name: string) => readFileSync(join(SRC, name), "utf8")

/** Every style sheet under studio/src, as a path relative to it with forward slashes. */
function sheets(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sheets(path)
    return entry.name.endsWith(".css") ? [relative(SRC, path).replaceAll("\\", "/")] : []
  })
}

/** The declarations of the first rule with exactly this selector in `css`, or "". */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`)
  return at < 0 ? "" : css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at))
}

const theme = () => read("shell/theme.css")
const token = (name: string) => new RegExp(`\\n\\s*${name}: *([^;]+);`).exec(theme())?.[1]

describe("the chrome's tokens", () => {
  test("copper is the one accent: the colour, its hover, its wash and the text on it", () => {
    expect([token("--copper"), token("--copper-strong"), token("--copper-wash"), token("--on-copper")]).toEqual(["#C8702A", "#B0601F", "#F7EAD9", "#FFFFFF"])
  })

  test("the neutrals are cool and quiet", () => {
    expect({
      panel: token("--panel"),
      ground: token("--ground"),
      strip: token("--strip"),
      line: token("--line"),
      lineHover: token("--line-strong"),
      text: token("--text"),
      muted: token("--muted"),
      disabled: token("--disabled"),
    }).toEqual({ panel: "#FFFFFF", ground: "#F5F6F8", strip: "#F5F6F8", line: "#E3E5E8", lineHover: "#CFD3D8", text: "#1F2328", muted: "#656D76", disabled: "#9AA1A9" })
  })

  test("menus and dialogs share one soft shadow", () => {
    expect(token("--shadow")).toBe("0 4px 16px rgb(31 35 40 / 12%)")
  })

  test("the tokens are defined once, in theme.css", () => {
    for (const sheet of sheets().filter((s) => s !== "shell/theme.css")) {
      expect([sheet, /--(copper|panel|line|text|muted|strip|ground|disabled)\s*:/.test(read(sheet))]).toEqual([sheet, false])
    }
  })

  test("no style sheet but theme.css names a raw hex colour", () => {
    const found = sheets()
      .filter((sheet) => sheet !== "shell/theme.css")
      .flatMap((sheet) => [...read(sheet).matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => `${sheet}: ${m[0]}`))
    expect(found).toEqual([])
  })

  test("theme.css is loaded right after styles.css", () => {
    expect(read("main.tsx")).toMatch(/import "\.\/styles\.css"\nimport "\.\/shell\/theme\.css"/)
  })
})

describe("device-pixel hairlines", () => {
  test("dprStyle maps the device pixel ratio to the --dpr property", () => {
    expect(dprStyle(1)).toEqual({ "--dpr": "1" })
    expect(dprStyle(1.1)).toEqual({ "--dpr": "1.1" })
    expect(dprStyle(1.25)).toEqual({ "--dpr": "1.25" })
  })

  test("a missing or broken ratio falls back to 1", () => {
    expect(dprStyle(0)).toEqual({ "--dpr": "1" })
    expect(dprStyle(Number.NaN)).toEqual({ "--dpr": "1" })
    expect(dprStyle(-2)).toEqual({ "--dpr": "1" })
  })

  test("watchDpr sets --dpr on the root and follows zoom until stopped", () => {
    const fake = fakeWindow(1.1)
    const stop = watchDpr(fake.window)
    expect(fake.props.get("--dpr")).toBe("1.1")
    fake.zoom(1.25)
    expect(fake.props.get("--dpr")).toBe("1.25")
    expect(fake.queries.at(-1)).toBe("(resolution: 1.25dppx)")
    stop()
    fake.zoom(1.5)
    expect(fake.props.get("--dpr")).toBe("1.25")
    expect(fake.listeners.size).toBe(0)
  })

  test("the hairline rules scale a 1px line down by --dpr from the edge they sit on", () => {
    const css = read("shell/hairline.css")
    expect(theme()).toMatch(/\n\s*--dpr: 1;/)
    for (const side of ["b", "t"]) {
      const block = rule(css, `.hairline-${side}::after`)
      expect(block).toContain("height: 1px;")
      expect(block).toContain("transform: scaleY(calc(1 / var(--dpr)));")
      expect(block).toContain(`transform-origin: ${side === "b" ? "bottom" : "top"};`)
    }
    for (const side of ["r", "l"]) {
      const block = rule(css, `.hairline-${side}::after`)
      expect(block).toContain("width: 1px;")
      expect(block).toContain("transform: scaleX(calc(1 / var(--dpr)));")
      expect(block).toContain(`transform-origin: ${side === "r" ? "right" : "left"};`)
    }
  })

  test("main.tsx loads the hairline sheet and the app watches the ratio", () => {
    expect(read("main.tsx")).toContain('import "./shell/hairline.css"')
    expect(read("App.tsx")).toMatch(/watchDpr\(window\)/)
  })

  /** [component, class list] of the chrome's edges: panels, strips, tabs, heads. */
  const EDGES: [string, string][] = [
    ["shell/MenuBar.tsx", "menubar hairline-b"],
    ["shell/ToolbarRow.tsx", "studio-toolbar hairline-b"],
    ["shell/DocTabs.tsx", "doc-tabs hairline-b"],
    ["shell/BottomStrip.tsx", "bottom-strip hairline-t"],
    ["shell/BottomPanel.tsx", "bottom-panel hairline-t"],
    ["LeftPanel.tsx", "sub-tabs hairline-b"],
    ["LeftPanel.tsx", "panel left hairline-r"],
    ["InspectorRows.tsx", "insp-head hairline-t"],
    ["ChecksPanel.tsx", "checks-head hairline-b"],
    ["FindResults.tsx", "find-head hairline-b"],
    ["shell/FilterPanel.tsx", "filter-head hairline-b"],
    ["shell/LayerPanel.tsx", "layer-filters hairline-b"],
    ["LibraryTable.tsx", "lib-table-scroll hairline-t"],
  ]

  test("the chrome's edges are hairlines", () => {
    for (const [file, classes] of EDGES) expect([file, read(file).includes(`className="${classes}"`)]).toEqual([file, true])
    expect(read("shell/SideStrip.tsx")).toMatch(/hairline-\$\{side === "left" \? "r" : "l"\}/)
  })

  test("those edges, the rows and the separators draw no 1px border of their own", () => {
    const bordered = [
      ["shell/shell.css", ".menubar"], ["shell/toolbar.css", ".studio-toolbar"], ["shell/doc-tabs.css", ".doc-tabs"], ["shell/doc-tabs.css", ".doc-tab"],
      ["shell/bottom.css", ".bottom-strip"], ["shell/bottom.css", ".bottom-tab"], ["shell/bottom.css", ".bottom-panel"], ["shell/strips.css", ".sub-tabs"],
      ["shell/strips.css", ".side-strip"], ["shell/strips.css", ".panel.left"], ["shell/strips.css", ".panel.right"],
      ["inspector.css", ".insp-head"], ["checks-panel.css", ".checks-head"], ["find.css", ".find-head"], ["shell/filter-panel.css", ".filter-head"],
      ["shell/filter-panel.css", ".filter-row"], ["shell/layer-panel.css", ".layer-filters"], ["shell/layer-panel.css", ".layer-row"],
      ["library-table.css", ".lib-table-scroll"], ["library-table.css", ".lib-table th"], ["library-table.css", ".lib-table td"],
    ]
    for (const [sheet, selector] of bordered) {
      const block = rule(read(sheet!), selector!)
      expect([selector, block === "", /border(-\w+)?: 1px/.test(block)]).toEqual([selector, false, false])
    }
    for (const [sheet, selector] of [["shell/toolbar.css", ".toolbar-separator"], ["shell/toolbar.css", ".tool-divider"]]) {
      expect(rule(read(sheet!), selector!)).toContain("transform: scaleX(calc(1 / var(--dpr)));")
    }
    expect(rule(read("shell/shell.css"), ".menu-separator")).toContain("transform: scaleY(calc(1 / var(--dpr)));")
  })

  test("tabs in a bar, table rows and list rows take a hairline", () => {
    const css = read("shell/hairline.css")
    for (const row of [".doc-tab", ".bottom-tab", ".lib-table th", ".lib-table td", ".filter-row", ".layer-row", ".bom th", ".bom td", ".dialog td"]) {
      expect([row, new RegExp(`\\n${row.replace(/\./g, "\\.")}::after(,|\\s*\\{)`).test(css)]).toEqual([row, true])
    }
  })

  test("no edge is a box shadow: the shadows left are the soft one on floating things", () => {
    const shadows = sheets().flatMap((sheet) => [...read(sheet).matchAll(/box-shadow: ([^;]+);/g)].map((m) => m[1]))
    for (const shadow of shadows) expect(shadow).toBe("var(--shadow)")
  })
})

describe("type", () => {
  test("panel text and fields are 13px on 20px lines", () => {
    expect(rule(read("styles.css"), "body")).toContain("font: 13px/20px var(--sans);")
  })

  test("strip tabs are 12px", () => {
    for (const [sheet, selector] of [["shell/doc-tabs.css", ".doc-tab"], ["shell/bottom.css", ".bottom-tab"], ["shell/strips.css", ".side-tab"], ["shell/strips.css", ".sub-tab"]]) {
      expect([selector, rule(read(sheet!), selector!)]).toEqual([selector, expect.stringContaining("font-size: 12px;")])
    }
  })

  test("section headers are 12px, weight 600, no letter-spacing", () => {
    const heads = [["inspector.css", ".insp-head"], ["shell/filter-panel.css", ".filter-head"], ["checks-panel.css", ".checks-head h2"], ["find.css", ".find-head h2"], ["styles.css", ".tree h3"], ["styles.css", ".inspector h3"], ["styles.css", ".library h3"]]
    for (const [sheet, selector] of heads) {
      const block = rule(read(sheet!), selector!)
      expect([selector, block.includes("font-size: 12px;"), block.includes("font-weight: 600;"), block.includes("letter-spacing: 0;")]).toEqual([selector, true, true, true])
    }
  })

  test("nothing is upper-cased by a style sheet", () => {
    for (const sheet of sheets()) expect([sheet, /text-transform: *uppercase/.test(read(sheet))]).toEqual([sheet, false])
  })

  test("11px is the status line's alone", () => {
    const small = sheets().flatMap((sheet) => {
      const css = read(sheet)
      return [...css.matchAll(/\n([^\n{}]+) \{[^}]*font-size: 11px;/g)].map((m) => `${sheet}: ${m[1]}`)
    })
    expect(small.sort()).toEqual(["styles.css: .canvas-status", "styles.css: .canvas-status .unit-toggle"])
  })
})

/** A window with a root style, a ratio that zoom changes, and the listeners and media queries watchDpr adds. */
function fakeWindow(ratio: number) {
  const props = new Map<string, string>()
  const listeners = new Map<string, () => void>()
  const queries: string[] = []
  const state = { ratio }
  const window = {
    get devicePixelRatio() {
      return state.ratio
    },
    document: { documentElement: { style: { setProperty: (name: string, value: string) => void props.set(name, value) } } },
    addEventListener: (type: string, fn: () => void) => void listeners.set(type, fn),
    removeEventListener: (type: string) => void listeners.delete(type),
    matchMedia: (query: string) => {
      queries.push(query)
      return {
        addEventListener: (_: string, fn: () => void) => void listeners.set(query, fn),
        removeEventListener: () => void listeners.delete(query),
      }
    },
  } as unknown as Window
  const zoom = (next: number) => {
    const query = queries.at(-1) ?? ""
    state.ratio = next
    listeners.get(query)?.()
  }
  return { window, props, listeners, queries, zoom }
}

describe("text contrast", () => {
  /** A token's hex value, following one `var(--x)` alias. */
  const hex = (name: string): string => {
    const value = token(name) ?? ""
    const alias = /^var\((--[\w-]+)\)$/.exec(value)?.[1]
    return alias ? hex(alias) : value
  }

  test("contrastRatio is WCAG's: black on white 21, a colour on itself 1, symmetric", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5)
    expect(contrastRatio("#C8702A", "#C8702A")).toBeCloseTo(1, 5)
    expect(contrastRatio("#C8702A", "#FFFFFF")).toBeCloseTo(contrastRatio("#FFFFFF", "#C8702A"), 9)
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2)
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 5)
  })

  test("contrastRatio refuses what is not a hex colour", () => {
    expect(() => contrastRatio("var(--copper)", "#FFFFFF")).toThrow(/hex colour/)
  })

  /** [text, background] pairs the chrome sets text in. */
  const TEXT_PAIRS: [string, string][] = [
    ["--on-copper", "--copper-strong"], // the primary button
    ["--on-copper", "--copper-text"], // the primary button, hovered
    ["--copper-text", "--panel"], // links, badges, history "who", the brand
    ["--copper-text", "--copper-wash"], // the layer filter that is on, the active page-tree row, canvas tool toggles
    ["--agent", "--panel"],
    ["--text", "--copper-wash"], // selected and active rows
    ["--text", "--panel"],
    ["--text", "--strip"],
    ["--muted", "--panel"],
    ["--muted", "--strip"],
    ["--danger-text", "--panel"],
    ["--danger-text", "--danger-wash"],
    ["--mask", "--panel"],
    ["--mask", "--good-wash"],
  ]

  test("every text pair is at least 4.5:1", () => {
    for (const [text, background] of TEXT_PAIRS) {
      const ratio = contrastRatio(hex(text), hex(background))
      expect([text, background, ratio >= 4.5]).toEqual([text, background, true])
    }
  })

  test("the copper accents that are not text are at least 3:1: the underline and the pressed icon", () => {
    expect(contrastRatio(hex("--copper"), hex("--panel"))).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(hex("--copper"), hex("--copper-wash"))).toBeGreaterThanOrEqual(3)
  })

  test("copper text is --copper-text: the lighter coppers colour no text", () => {
    for (const sheet of sheets()) {
      const css = read(sheet)
      const bare = [...css.matchAll(/\n([^\n{}]+) \{([^}]*)\}/g)].filter((m) => /(^|\n)\s*color: var\(--copper(-strong)?\);/.test(m[2] ?? "")).map((m) => m[1])
      // The pressed toolbar icon is a graphic, not text: --copper on the wash, 3:1.
      expect([sheet, bare.filter((selector) => !selector?.includes("toolbar-button"))]).toEqual([sheet, []])
    }
  })

  test("muted text never sits on the copper wash: selected and active rows turn it to --text", () => {
    const styles = read("styles.css")
    expect(styles).toMatch(/\.row\.selected \.value,[^{]*\{\s*color: var\(--text\);/)
    expect(read("find.css")).toMatch(/button\.find-row\.active \.kind,\s*button\.find-row\.active \.matched \{\s*color: var\(--text\);/)
    expect(read("checks-panel.css")).toMatch(/\.check-row\.active \.items \{\s*color: var\(--text\);/)
  })
})
