import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readEntries, redoChange, undoChange } from "../src/core/index.js"
import { makeSubSheet, previewSubSheet } from "../src/core/make-sheet.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { CUT_MAIN } from "./helpers/cut-fixture.js"

const FILE = "main.circuit.tsx"
const SHEET = "Filter.sheet.tsx"
const SELECTED = ["R5", "C3", "R6"]
let root: string

const read = (file: string) => readFile(join(root, file), "utf8")
const exists = (file: string) => stat(join(root, file)).then(() => true, () => false)

/** Each net of the built design as its sorted pins, the nets sorted; pins renamed by `rename`. */
async function netsOf(rename: (pin: string) => string = (pin) => pin): Promise<string[]> {
  const design = await inProcessEngine.build(root, FILE)
  return design.circuit.nets
    .map((net) => net.pins.map(rename).sort().join(" "))
    .filter((pins) => pins.includes(" "))
    .sort()
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-make-sheet-"))
  await writeFile(join(root, FILE), CUT_MAIN)
})

describe("making a sub-sheet from a selection", () => {
  test("the preview names the file, instance, base, ports and the designators now, in the sheet and on the board", async () => {
    const preview = await previewSubSheet(root, FILE, { name: "Filter", parts: SELECTED, rename: true })
    expect(preview).toMatchObject({ file: SHEET, sheet: "Filter", instance: "F1", base: 100, connections: { C3_pin2: "C3_pin2", "D[0:3]": "D[0:3]", VIN: "VIN" } })
    expect(preview.mapping).toEqual([
      { from: "C3", to: "C1", flat: "C101" },
      { from: "R5", to: "R1", flat: "R101" },
      { from: "R6", to: "R2", flat: "R102" },
    ])
    expect(await exists(SHEET)).toBe(false)
  })

  test("the built design keeps every connection, the parts under their new designators", async () => {
    const before = await netsOf((pin) => pin.replace(/^R5\./, "R105.").replace(/^C3\./, "C103.").replace(/^R6\./, "R106."))
    expect(before).toEqual(["C103.pin1 R105.pin2", "C103.pin2 R7.pin2", "R105.pin1 R7.pin1", "R106.pin1 R8.pin1"])
    await makeSubSheet(root, FILE, { name: "Filter", parts: SELECTED }, { author: "human" })
    const design = await inProcessEngine.build(root, FILE)
    expect(design.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    expect(await netsOf()).toEqual(before)
  })

  test("is one history entry touching both files; undo restores the circuit and removes the sheet, redo brings both back", async () => {
    const { entry } = await makeSubSheet(root, FILE, { name: "Filter", parts: SELECTED }, { author: "human" })
    const [made, sheet] = [await read(FILE), await read(SHEET)]
    expect(entry.file).toBe(FILE)
    expect(entry.also?.map((change) => change.file)).toEqual([SHEET])
    expect(entry.summary).toBe("make sub-sheet Filter (F1) from R5, C3, R6")
    await undoChange(root, { author: "human" })
    expect(await read(FILE)).toBe(CUT_MAIN)
    expect(await exists(SHEET)).toBe(false)
    await redoChange(root, { author: "human" })
    expect([await read(FILE), await read(SHEET)]).toEqual([made, sheet])
    expect(await readEntries(root)).toHaveLength(3)
  })

  test("takes the next free base: past the instances there are, and past a designator a part already has", async () => {
    await writeFile(join(root, FILE), CUT_MAIN.replace(`<resistor name="R8"`, `<resistor name="R105" />\n    <resistor name="R8"`))
    expect((await previewSubSheet(root, FILE, { name: "Filter", parts: SELECTED })).base).toBe(200)
  })

  test("refuses a bad sheet name, an existing sheet file, a locked part and an empty selection; nothing is written", async () => {
    await expect(previewSubSheet(root, FILE, { name: "filter", parts: SELECTED })).rejects.toThrow(/not a sheet name/)
    await expect(previewSubSheet(root, FILE, { name: "Filter", parts: [] })).rejects.toThrow(/Select the parts/)
    await writeFile(join(root, SHEET), "old")
    await expect(makeSubSheet(root, FILE, { name: "Filter", parts: SELECTED }, { author: "human" })).rejects.toThrow(/Filter\.sheet\.tsx already exists/)
    expect(await read(SHEET)).toBe("old")
    expect(await read(FILE)).toBe(CUT_MAIN)
    expect(await readEntries(root)).toHaveLength(0)
  })
})

describe("the make_sheet tool", () => {
  test("answers compactly with the file, the instance, the ports and the designators; undo_change takes both files back", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js")
    const { createCopperflowServer } = await import("../src/mcp/server.js")
    const server = createCopperflowServer(root, { engine: inProcessEngine as never })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: "test", version: "0.0.0" })
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args })
      return { text: (result.content as { text: string }[]).map((c) => c.text).join("\n"), isError: result.isError === true }
    }
    const answer = await call("make_sheet", { file: FILE, name: "Filter", parts: SELECTED, rename: true })
    expect(answer).toEqual({
      isError: false,
      text: [
        "Change c0001: wrote Filter.sheet.tsx; F1 Filter base 100 replaces 3 parts",
        "Ports: C3_pin2 D[0:3] (bus) VIN",
        "Designators: C3 → C1 (C101), R5 → R1 (R101), R6 → R2 (R102)",
        "Now call check_circuit once.",
      ].join("\n"),
    })
    expect((await call("check_circuit", { file: FILE })).text).toMatch(/^main\.circuit\.tsx: 0 errors/)
    expect(await call("make_sheet", { file: FILE, name: "Filter", parts: ["R7"] })).toEqual({ isError: true, text: "Filter.sheet.tsx already exists; choose another sheet name" })
    await call("undo_change", {})
    expect(await read(FILE)).toBe(CUT_MAIN)
    expect(await exists(SHEET)).toBe(false)
  })
})
