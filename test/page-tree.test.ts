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

  test("falls back to Project when the server gave no name", () => {
    expect(buildPageTree(undefined, [], undefined, "pcb").project).toBe("Project")
    expect(buildPageTree("", [], undefined, "pcb").project).toBe("Project")
  })
})
