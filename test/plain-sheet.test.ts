import { describe, expect, test } from "vitest"
import { checkPlainSheet } from "../src/core/plain-sheet.js"

const PLAIN = [
  'import { Tvs1 } from "./parts/TVS1/Tvs1"',
  "",
  "export default function Input() {",
  "  return (",
  '    <sheet does="input" sources={["https://example.com/a.pdf"]}>',
  '      <port name="IN" type="input" carries="0 to 24 V" />',
  "      {/* a note */}",
  '      <resistor name="R1" resistance="10k" footprint="0603" pcbX={-2.5} pcbY={3} />',
  '      <Tvs1 name="D1" pinAttributes={{ pin1: { isInput: true } }} list={[1, -2, "x"]} doNotPlace />',
  '      <trace from="R1.pin1" to="net.IN" />',
  "    </sheet>",
  "  )",
  "}",
  "",
].join("\n")

const swap = (from: string, to: string) => PLAIN.replace(from, to)

describe("a plain sheet", () => {
  test("literals, built-in tags and imported part components pass, and the parts are named", () => {
    expect(checkPlainSheet(PLAIN)).toEqual({ name: "Input", parts: [{ source: "./parts/TVS1/Tvs1", id: "TVS1", component: "Tvs1" }] })
  })

  const REFUSED: [string, string, string][] = [
    ["a call", swap('resistance="10k"', "resistance={make()}"), "line 8: a call"],
    ["a member access", swap('resistance="10k"', "resistance={Math.PI}"), "line 8: a member access"],
    ["an extra import", `import fs from "node:fs"\n${PLAIN}`, 'line 1: an import of "node:fs"'],
    ["a second statement", swap("  return (", "  const x = 1\n  return ("), "line 4: a statement before the return"],
    ["a spread attribute", swap('<Tvs1 name="D1"', '<Tvs1 name="D1" {...extra}'), "line 9: a spread"],
    ["an identifier", swap("pcbY={3}", "pcbY={y}"), "line 8: a reference to y"],
    ["a template", swap('resistance="10k"', "resistance={`10k`}"), "line 8: a template"],
    ["a tag that is not imported", swap("<Tvs1 ", "<Other "), "line 9: the tag Other, which is not an imported part"],
    ["a member tag", swap("<Tvs1 ", "<Tvs1.X "), "line 9: the tag Tvs1.X"],
    ["an expression child", swap("{/* a note */}", "{items}"), "line 7: a reference to items"],
    ["a parameter", swap("function Input()", "function Input(props)"), "line 3: a parameter"],
    ["an import from elsewhere", swap('"./parts/TVS1/Tvs1"', '"../parts/TVS1/Tvs1"'), 'line 1: an import of "../parts/TVS1/Tvs1"'],
    ["a renamed import", swap("{ Tvs1 }", "{ Tvs1 as T }"), "line 1: an import of"],
    ["a computed key", swap("{ pin1:", "{ [k]:"), "line 9: a computed key"],
    ["a second export", `${PLAIN}export const x = 1\n`, "line 14: a statement after the default export"],
    ["an arrow body", swap("export default function Input() {\n  return (", "export default () => (").replace("  )\n}", "  )"), "line 3: a default export that is not a function"],
    ["a negated text", swap("pcbX={-2.5}", 'pcbX={-"2"}'), "line 8: a negation of something other than a number"],
    ["a type assertion", swap("pcbY={3}", "pcbY={3 as number}"), "line 8: a TSAsExpression"],
  ]
  for (const [what, text, reason] of REFUSED) {
    test(`refuses ${what}`, () => {
      expect(() => checkPlainSheet(text)).toThrow(reason)
    })
  }

  test("a sheet that does not parse is refused", () => {
    expect(() => checkPlainSheet("export default function (")).toThrow("does not parse")
  })
})
