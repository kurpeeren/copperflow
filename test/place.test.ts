import { beforeEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits, EditError } from "../src/core/edit.js"
import { createPart } from "../src/core/library.js"
import { placePart, suggestName } from "../src/core/place.js"
import { BOARD, LDO } from "./fixtures.js"

const none = new Set<string>()

function editError(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(EditError)
    return (error as EditError).code
  }
  throw new Error("expected an EditError")
}

describe("addPart", () => {
  test("inserts the part before the first trace with matching indentation", () => {
    const out = applyEdits(BOARD, [{ kind: "addPart", tag: "resistor", name: "R4", props: { resistance: "10k", pcbX: 2 } }], none)
    expect(out).toContain('    <resistor name="R4" resistance="10k" pcbX={2} />\n    <trace from=".R1 > .pin1"')
    expect(analyzeCircuit(out).parts.find((p) => p.name === "R4")?.editable).toBe(true)
  })

  test("inserts before </board> when there are no traces", () => {
    const out = applyEdits('<board>\n  <led name="D1" />\n</board>\n', [{ kind: "addPart", tag: "resistor", name: "R1" }], none)
    expect(out).toBe('<board>\n  <led name="D1" />\n  <resistor name="R1" />\n</board>\n')
  })

  test("adds the import once, after the existing imports", () => {
    const edit = { kind: "addPart" as const, tag: "AP2112K_3_3", name: "U2", importFrom: "./parts/AP2112K-3.3/AP2112K_3_3" }
    const out = applyEdits(BOARD, [edit], none)
    expect(out.split("\n").slice(0, 2)).toEqual([
      'import { regulatorProps, offset } from "./shared"',
      'import { AP2112K_3_3 } from "./parts/AP2112K-3.3/AP2112K_3_3"',
    ])
    const twice = applyEdits(out, [{ ...edit, name: "U3" }], none)
    expect(twice.match(/import \{ AP2112K_3_3 \}/g)).toHaveLength(1)
  })

  test("adds the import at the top of a file without imports", () => {
    const out = applyEdits("export default () => (\n  <board>\n  </board>\n)\n", [{ kind: "addPart", tag: "LDO", name: "U1", importFrom: "./parts/LDO/LDO" }], none)
    expect(out.startsWith('import { LDO } from "./parts/LDO/LDO"\n')).toBe(true)
  })

  test("rejects duplicate names, bad tags and import paths that are not relative", () => {
    expect(editError(() => applyEdits(BOARD, [{ kind: "addPart", tag: "resistor", name: "R1" }], none))).toBe("invalid")
    expect(editError(() => applyEdits(BOARD, [{ kind: "addPart", tag: "resistor x", name: "R9" }], none))).toBe("invalid")
    expect(editError(() => applyEdits(BOARD, [{ kind: "addPart", tag: "resistor", name: "R 9" }], none))).toBe("invalid")
    expect(editError(() => applyEdits(BOARD, [{ kind: "addPart", tag: "X", name: "U9", importFrom: 'evil";' }], none))).toBe("invalid")
  })
})

describe("suggestName", () => {
  test("uses the usual prefix and the next free number", () => {
    const model = analyzeCircuit(BOARD)
    expect(suggestName(model, "resistor", false)).toBe("R2")
    expect(suggestName(model, "led", false)).toBe("LED2")
    expect(suggestName(model, "LDO", true)).toBe("U2")
    expect(suggestName(model, "pushbutton", false)).toBe("SW1")
  })
})

describe("placePart", () => {
  let root: string
  const FILE = "boards/main.circuit.tsx"

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cf-place-"))
    await mkdir(join(root, "boards"))
    await writeFile(join(root, FILE), BOARD)
    await createPart(root, "LDO", LDO, { now: "2026-11-03T10:00:00.000Z" })
  })

  test("places a library part with an import relative to the circuit file", async () => {
    const result = await placePart(root, FILE, { part: "LDO", name: "U2", props: { pcbX: 5 } }, { author: "ai" })
    expect(result.entry.summary).toBe("place U2 (LDO)")
    const text = await readFile(join(root, FILE), "utf8")
    expect(text).toContain('import { LDO } from "../parts/LDO/LDO"')
    expect(text).toContain('<LDO name="U2" pcbX={5} />')
  })

  test("places built-in parts and rejects unknown ones", async () => {
    await placePart(root, FILE, { part: "capacitor", name: "C9", props: { capacitance: "100nF" } }, { author: "ai" })
    expect(await readFile(join(root, FILE), "utf8")).toContain('<capacitor name="C9" capacitance="100nF" />')
    await expect(placePart(root, FILE, { part: "flux_capacitor", name: "X1" }, { author: "ai" })).rejects.toThrow(/list_parts/)
  })
})
