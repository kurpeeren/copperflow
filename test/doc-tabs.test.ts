import { describe, expect, test } from "vitest"
import { DOC_TAB_ORDER, docTabs, tabTarget, withLookTab } from "../studio/src/shell/doc-tabs.js"
import { tabAfterKey } from "../studio/src/shell/tab-keys.js"

describe("document tabs", () => {
  test("titles drop the circuit extension, Schematic first", () => {
    expect(docTabs("index.circuit.tsx", "pcb").map((t) => t.title)).toEqual(["index Schematic", "index PCB"])
  })

  test("only the open view is active", () => {
    expect(docTabs("a.circuit.tsx", "schematic").map((t) => t.active)).toEqual([true, false])
    expect(docTabs("a.circuit.tsx", "pcb").map((t) => t.active)).toEqual([false, true])
  })

  test("falls back to the bare label before a file is chosen", () => {
    expect(docTabs(undefined, "pcb").map((t) => t.title)).toEqual(["Schematic", "PCB"])
  })

  test("arrow keys move between the two tabs", () => {
    expect(tabAfterKey(DOC_TAB_ORDER, "schematic", "ArrowRight")).toBe("pcb")
    expect(tabAfterKey(DOC_TAB_ORDER, "pcb", "ArrowRight")).toBe("schematic")
    expect(tabAfterKey(DOC_TAB_ORDER, "schematic", "ArrowLeft")).toBe("pcb")
    expect(tabAfterKey(DOC_TAB_ORDER, "pcb", "Home")).toBe("schematic")
    expect(tabAfterKey(DOC_TAB_ORDER, "schematic", "End")).toBe("pcb")
    expect(tabAfterKey(DOC_TAB_ORDER, "pcb", "a")).toBeNull()
  })
})

describe("the 3D tab", () => {
  test("follows the PCB tab of a circuit, titled like it, and is the open one while the 3D view is", () => {
    const tabs = withLookTab(docTabs("index.circuit.tsx", "pcb"), "index.circuit.tsx", true)
    expect(tabs.map((t) => [t.id, t.title, t.active])).toEqual([
      ["schematic", "index Schematic", false],
      ["pcb", "index PCB", false],
      ["3d", "index 3D", true],
    ])
    expect(withLookTab(docTabs("index.circuit.tsx", "pcb"), "index.circuit.tsx", false).map((t) => t.active)).toEqual([false, true, false])
  })

  test("a sheet has none, since its parts are on the circuit's board", () => {
    expect(withLookTab(docTabs("Power.sheet.tsx", "schematic"), "Power.sheet.tsx", false).map((t) => t.id)).toEqual(["schematic"])
  })

  test("its id opens the 3D view over the PCB", () => {
    expect(tabTarget("3d")).toEqual({ view: "pcb", look: true })
  })
})
