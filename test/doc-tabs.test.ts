import { describe, expect, test } from "vitest"
import { docTabs, tabAfterKey } from "../studio/src/shell/doc-tabs.js"

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
    expect(tabAfterKey("ArrowRight", "schematic")).toBe("pcb")
    expect(tabAfterKey("ArrowRight", "pcb")).toBe("schematic")
    expect(tabAfterKey("ArrowLeft", "schematic")).toBe("pcb")
    expect(tabAfterKey("Home", "pcb")).toBe("schematic")
    expect(tabAfterKey("End", "schematic")).toBe("pcb")
    expect(tabAfterKey("a", "pcb")).toBeNull()
  })
})
