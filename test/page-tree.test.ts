import { describe, expect, test } from "vitest"
import { buildPageTree } from "../studio/src/shell/page-tree.js"

describe("page tree", () => {
  test("lists Schematic and PCB under every circuit file", () => {
    const tree = buildPageTree("demo", ["a.circuit.tsx", "b.circuit.tsx"], "a.circuit.tsx", "pcb")
    expect(tree.project).toBe("demo")
    expect(tree.files.map((f) => f.documents.map((d) => d.label))).toEqual([
      ["Schematic", "PCB"],
      ["Schematic", "PCB"],
    ])
  })

  test("only the open file's open view is active", () => {
    const tree = buildPageTree("demo", ["a.circuit.tsx", "b.circuit.tsx"], "b.circuit.tsx", "schematic")
    const active = tree.files.flatMap((f) => f.documents.filter((d) => d.active).map((d) => `${f.file}:${d.view}`))
    expect(active).toEqual(["b.circuit.tsx:schematic"])
  })

  test("remembers the open view, so a file row opens its file there", () => {
    expect(buildPageTree("demo", ["a.circuit.tsx"], "a.circuit.tsx", "schematic").view).toBe("schematic")
  })

  test("the document tabs list the same documents in the same order", async () => {
    const { DOC_VIEWS } = await import("../studio/src/shell/page-tree.js")
    const { DOC_TAB_ORDER } = await import("../studio/src/shell/doc-tabs.js")
    expect(DOC_TAB_ORDER).toEqual(DOC_VIEWS.map((v) => v.view))
    expect(buildPageTree("demo", ["a.circuit.tsx"], undefined, "pcb").files[0]?.documents.map((d) => d.view)).toEqual(DOC_TAB_ORDER)
  })

  test("falls back to Project when the server gave no name", () => {
    expect(buildPageTree(undefined, [], undefined, "pcb").project).toBe("Project")
    expect(buildPageTree("", [], undefined, "pcb").project).toBe("Project")
  })
})
