import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

const read = (name: string) => readFileSync(new URL(`../studio/src/${name}`, import.meta.url), "utf8")
/** Counted as `wc -l` does: the newlines. */
const lineCount = (text: string) => text.split("\n").length - 1

/** styles.css's length after round 1 of the EasyEDA shell; new rules go in their own sheets, so it must not grow. */
const STYLES_CAP = 684

/** The rules the Checks panel brought: its colour tokens and the status pill. */
const CHECK_RULES = ["--check-error:", "--check-warning:", "button.build {"]

/** Every sheet that could hold a layout rule for the workspace row or its centre column. */
const SHEETS = ["styles.css", "checks-panel.css", "inspector.css", "shell/shell.css", "shell/strips.css", "shell/doc-tabs.css", "shell/bottom.css", "shell/toolbar.css"]

/** The declarations of the first rule with exactly this selector in `css`, or undefined. */
function rule(css: string, selector: string): string | undefined {
  const at = css.indexOf(`\n${selector} {`)
  return at < 0 ? undefined : css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at))
}

describe("Studio style sheets", () => {
  test("the Checks panel's rules live in checks-panel.css, not styles.css", () => {
    const styles = read("styles.css")
    const panel = read("checks-panel.css")
    for (const rule of CHECK_RULES) {
      expect([rule, styles.includes(rule)]).toEqual([rule, false])
      expect([rule, panel.includes(rule)]).toEqual([rule, true])
    }
  })

  test("styles.css has not grown", () => {
    expect(lineCount(read("styles.css"))).toBeLessThanOrEqual(STYLES_CAP)
  })

  test("the workspace row and its centre column are laid out in workspace.css alone", () => {
    for (const sheet of SHEETS) expect([sheet, /\.center\b|\.workspace\b/.test(read(sheet))]).toEqual([sheet, false])
    const layout = read("shell/workspace.css")
    expect(rule(layout, ".workspace > .center")).toContain("grid-template-rows: auto minmax(0, 1fr) auto;")
  })

  test("a side tab is as tall as its label, not the 24px square the global button rule makes", () => {
    expect(rule(read("styles.css"), "button")).toContain("height: 24px;")
    const tab = rule(read("shell/strips.css"), ".side-tab") ?? ""
    expect(tab).toContain("height: auto;")
    expect(tab).toContain("flex: none;")
    expect(tab).toContain("writing-mode: vertical-rl;")
  })

  test("chrome corners are square or 2px, and only menus, dialogs and the toast cast a shadow", () => {
    for (const sheet of SHEETS) {
      const css = read(sheet)
      const radii = [...css.matchAll(/border-radius: ([^;]+);/g)].map((m) => m[1])
      expect([sheet, radii.filter((r) => !["0", "2px", "50%"].includes(r ?? ""))]).toEqual([sheet, []])
    }
    const shadows = SHEETS.flatMap((sheet) => [...read(sheet).matchAll(/\n([^\n{}]+) {[^}]*box-shadow: (?!inset)/g)].map((m) => m[1]))
    expect(shadows.sort()).toEqual([".dialog", ".menu-dropdown", ".toast"])
  })

  test("the :root tokens carry the light chrome colours", () => {
    const root = /:root\s*{([^}]*)}/.exec(read("styles.css"))?.[1] ?? ""
    const token = (name: string) => new RegExp(`${name}: *([^;]+);`).exec(root)?.[1]
    expect({
      text: token("--text"),
      panel: token("--panel"),
      line: token("--line"),
      accent: token("--copper"),
      strip: token("--strip"),
      muted: token("--muted"),
      disabled: token("--disabled"),
    }).toEqual({ text: "#333333", panel: "#ffffff", line: "#d1d1d1", accent: "#1890ff", strip: "#f0f0f0", muted: "#666666", disabled: "#999999" })
  })
})
