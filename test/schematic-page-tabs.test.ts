import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { docTabs, tabTarget } from "../studio/src/shell/doc-tabs.js"
import { buildPageTree } from "../studio/src/shell/page-tree.js"
import { deletePageRefusal, designOnPage, nextPageName, pageNames, renamePageRefusal, shownPage } from "../studio/src/shell/schematic-pages.js"

const MAIN = "index.circuit.tsx"
const source = [
  "export default () => (",
  '  <board width="10mm" height="10mm">',
  '    <resistor name="R1" />',
  '    <resistor name="R2" />',
  '    <trace from="R1.pin1" to="net.GND" />',
  '    <trace from="R2.pin1" to="net.GND" />',
  '    <page name="Power">',
  '      <capacitor name="C1" />',
  '      <trace from="C1.pin1" to="net.GND" />',
  '      <schematictext name="Title" x={0} y={2} text="Power" />',
  "    </page>",
  '    <page name="Spare">',
  "    </page>",
  "  </board>",
  ")",
  "",
].join("\n")
const design = buildDesign({ [MAIN]: source }, MAIN)

describe("the tabs of a schematic with pages", () => {
  test("a Schematic tab per page named index — page, then the PCB", () => {
    const tabs = docTabs(MAIN, "schematic", pageNames(design), "Power")
    expect(tabs.map((t) => [t.id, t.title, t.active])).toEqual([
      ["schematic:Main", "index — Main", false],
      ["schematic:Power", "index — Power", true],
      ["schematic:Spare", "index — Spare", false],
      ["pcb", "index PCB", false],
    ])
    expect(tabs.map((t) => tabTarget(t.id))).toEqual([
      { view: "schematic", page: "Main" },
      { view: "schematic", page: "Power" },
      { view: "schematic", page: "Spare" },
      { view: "pcb" },
    ])
  })

  test("one page keeps the single Schematic tab", () => {
    expect(docTabs(MAIN, "pcb", ["Main"], "Main").map((t) => t.title)).toEqual(["index Schematic", "index PCB"])
    expect(tabTarget("schematic")).toEqual({ view: "schematic" })
  })

  test("the page tree lists the open file's pages under it; other files keep one Schematic row", () => {
    const tree = buildPageTree("demo", [MAIN, "other.circuit.tsx"], MAIN, "schematic", { names: pageNames(design), open: "Main" })
    expect(tree.files.map((f) => f.documents.map((d) => [d.label, d.page, d.active]))).toEqual([
      [
        ["Main", "Main", true],
        ["Power", "Power", false],
        ["Spare", "Spare", false],
        ["PCB", undefined, false],
      ],
      [
        ["Schematic", undefined, false],
        ["PCB", undefined, false],
      ],
    ])
  })
})

describe("one page of the design", () => {
  test("draws only what the page holds", () => {
    const power = designOnPage(design, "Power").schematic
    expect(power.symbols.map((s) => s.component)).toEqual(["C1"])
    expect(power.drawings.map((d) => d.id)).toEqual(["Title"])
    expect(power.labels.every((l) => l.net === "net.GND")).toBe(true)
    const main = designOnPage(design, "Main").schematic
    expect(main.symbols.map((s) => s.component)).toEqual(["R1", "R2"])
    expect(main.wires.length).toBeGreaterThan(0)
    expect(designOnPage(design, "Spare").schematic.symbols).toEqual([])
  })

  test("the PCB and the circuit stay whole", () => {
    const power = designOnPage(design, "Power")
    expect(power.pcb).toBe(design.pcb)
    expect(power.circuit).toBe(design.circuit)
  })

  test("a page that went away shows the first page", () => {
    expect(shownPage(design, "Power")).toBe("Power")
    expect(shownPage(design, "Gone")).toBe("Main")
    expect(shownPage(undefined, "Power")).toBe("Main")
  })
})

describe("the Page commands", () => {
  test("a new page takes the first free name", () => {
    expect(nextPageName(["Main"])).toBe("Page 2")
    expect(nextPageName(["Main", "Page 2", "Page 3"])).toBe("Page 4")
  })

  test("delete is refused while the page has parts, and for Main", () => {
    expect(deletePageRefusal(design, "Power")).toMatch(/still has parts \(C1\)/)
    expect(deletePageRefusal(design, "Main")).toMatch(/first page/)
    expect(deletePageRefusal(design, "Spare")).toBeUndefined()
    expect(renamePageRefusal("Main")).toMatch(/keeps its name/)
    expect(renamePageRefusal("Power")).toBeUndefined()
  })
})
