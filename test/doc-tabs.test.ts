import { describe, expect, test } from "vitest"
import { DOC_TAB_ORDER, docTabs } from "../studio/src/shell/doc-tabs.js"
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
