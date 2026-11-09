import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

const read = (name: string) => readFileSync(new URL(`../studio/src/${name}`, import.meta.url), "utf8")
/** Counted as `wc -l` does: the newlines. */
const lineCount = (text: string) => text.split("\n").length - 1

/** styles.css's length after round 1 of the EasyEDA shell; new rules go in their own sheets, so it must not grow. */
const STYLES_CAP = 684

/** The rule the Checks panel brought, the status pill; its colour tokens now sit with the others in theme.css. */
const CHECK_RULES = ["button.build {"]
const CHECK_TOKENS = ["--check-error:", "--check-warning:"]

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
    for (const token of CHECK_TOKENS) expect([token, read("shell/theme.css").includes(token)]).toEqual([token, true])
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

  test("chrome corners are square or 4px, and only menus, dialogs and the toast cast a shadow", () => {
    for (const sheet of SHEETS) {
      const css = read(sheet)
      const radii = [...css.matchAll(/border-radius: ([^;]+);/g)].map((m) => m[1])
      expect([sheet, radii.filter((r) => !["0", "4px", "50%"].includes(r ?? ""))]).toEqual([sheet, []])
    }
    const shadows = SHEETS.flatMap((sheet) => [...read(sheet).matchAll(/\n([^\n{}]+) {[^}]*box-shadow: (?!inset)/g)].map((m) => m[1]))
    expect(shadows.sort()).toEqual([".dialog", ".menu-dropdown", ".toast"])
  })

  test("the :root tokens in theme.css carry the light chrome colours", () => {
    const root = /:root\s*{([^}]*)}/.exec(read("shell/theme.css"))?.[1] ?? ""
    const token = (name: string) => new RegExp(`${name}: *([^;]+);`).exec(root)?.[1]
    expect({
      text: token("--text"),
      panel: token("--panel"),
      line: token("--line"),
      accent: token("--copper"),
      strip: token("--strip"),
      muted: token("--muted"),
      disabled: token("--disabled"),
    }).toEqual({ text: "#1F2328", panel: "#FFFFFF", line: "#E3E5E8", accent: "#C8702A", strip: "#F5F6F8", muted: "#656D76", disabled: "#9AA1A9" })
  })
})
