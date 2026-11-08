import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

const read = (name: string) => readFileSync(new URL(`../studio/src/${name}`, import.meta.url), "utf8")
/** Counted as `wc -l` does: the newlines. */
const lineCount = (text: string) => text.split("\n").length - 1

/** styles.css was this long before the Checks panel; it is past the 800-line ceiling and must not grow. */
const STYLES_BEFORE_CHECKS = 940

/** The rules the Checks panel brought: its colour tokens, the status pill and the column that holds the panel. */
const CHECK_RULES = ["--check-error:", "--check-warning:", "button.build {", ".center {"]

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
    expect(lineCount(read("styles.css"))).toBeLessThanOrEqual(STYLES_BEFORE_CHECKS)
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
