import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { partHeight } from "../../src/engine/solid/heights.js"
import { modelLine } from "../../src/engine/solid/limits.js"
import { solidModel } from "../../src/engine/solid/model.js"
import { PartSchema, verificationTemplate } from "../../src/core/library.js"

const MAIN = "main.circuit.tsx"
const part = (footprint: string | undefined, props: Record<string, unknown> = {}) => ({ ...(footprint === undefined ? {} : { footprint }), props })

describe("a height's state", () => {
  test("given when the part says its height", () => {
    expect(partHeight(part("0603", { height: 0.5 }))).toMatchObject({ height: 0.5, state: "given", assumed: false })
  })

  test("read when the table's row was read from a document named beside it", () => {
    const soic = partHeight(part("soic8"))
    expect(soic).toMatchObject({ height: 1.75, state: "read", assumed: false })
    expect(soic.source).toMatch(/p15/)
  })

  test("typical when the table's row was not read from a document", () => {
    expect(partHeight(part("0603"))).toMatchObject({ height: 0.9, state: "typical", assumed: false })
    expect(partHeight(part("pinrow4"))).toMatchObject({ state: "typical" })
  })

  test("assumed when nothing is known", () => {
    expect(partHeight(part("to220"))).toMatchObject({ height: 1, state: "assumed", assumed: true })
  })
})

describe("the board's thickness", () => {
  const rules = (thickness: number) => ({ "rules.yaml": `fabrication:\n  boardThickness: ${thickness}\n` })
  const files = (board: string, extra: Record<string, string> = {}) => ({ [MAIN]: `export default () => (<board width="20mm" height="10mm" ${board}><resistor name="R1" resistance="1k" footprint="0603" /></board>)`, ...extra })

  test("the board's own setting wins", () => {
    const design = buildDesign(files(`thickness="1mm"`, rules(0.8)), MAIN)
    expect(solidModel(design).board?.thickness).toBe(1)
  })

  test("then the rules' fabrication.boardThickness", () => {
    const model = solidModel(buildDesign(files("", rules(0.8)), MAIN))
    expect(model.board?.thickness).toBe(0.8)
    expect(model.parts[0]?.bottom).toBe(0.8)
  })

  test("then 1.6 mm", () => {
    expect(solidModel(buildDesign(files(""), MAIN)).board?.thickness).toBe(1.6)
  })
})

describe("the words about heights", () => {
  test("the STEP line names typical and assumed heights", () => {
    const parts = [
      { name: "R2", state: "typical" as const, assumed: false },
      { name: "R10", state: "typical" as const, assumed: false },
      { name: "K1", state: "assumed" as const, assumed: true },
      { name: "U1", state: "read" as const, assumed: false },
    ]
    expect(modelLine("led.step", parts)).toBe("led.step: parts are boxes, not their real shapes; heights marked typical come from a package table, assumed ones are guesses (typical: R2, R10; assumed: K1).")
    expect(modelLine("led.step", [])).toBe("led.step: parts are boxes, not their real shapes; heights marked typical come from a package table, assumed ones are guesses (none typical, none assumed).")
  })

  test("a part's height and its page become a checklist item", () => {
    const base = { title: "Relay", footprint: "footprint.yaml", pins: { "1": { name: "A", type: "passive" } } }
    const relay = PartSchema.parse({ ...base, height: 15.3, height_source: "p1, 5. DIMENSION, 15.3 mm max" })
    expect(verificationTemplate("relay", relay)).toContain("- [ ] Height 15.3 mm, p1, 5. DIMENSION, 15.3 mm max: compare\n")
    expect(verificationTemplate("relay", PartSchema.parse({ ...base, height: 2 }))).toContain("- [ ] Height 2 mm: compare\n")
    expect(verificationTemplate("relay", PartSchema.parse(base))).not.toContain("Height")
  })
})
