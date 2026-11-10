import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { analyzeCircuit, lockParts, readEntries, redoChange, undoChange, unlockParts, updateAnnotations } from "../src/core/index.js"
import { makeSubSheet, previewSubSheet } from "../src/core/make-sheet.js"
import { serializeLayout, type TrackRecord } from "../src/core/layout-file.js"
import { layoutNetRenamer } from "../src/core/sheet-cut-layout.js"
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
    expect(preview).toMatchObject({ file: SHEET, sheet: "Filter", instance: "Filter1", base: 100, connections: { C3_pin2: "C3_pin2", "D[0:3]": "D[0:3]", VIN: "VIN" } })
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
    await makeSubSheet(root, FILE, { name: "Filter", parts: SELECTED }, { author: "human", engine: inProcessEngine as never })
    const design = await inProcessEngine.build(root, FILE)
    expect(design.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    expect(await netsOf()).toEqual(before)
  })

  test("is one history entry touching both files; undo restores the circuit and removes the sheet, redo brings both back", async () => {
    const { entry } = await makeSubSheet(root, FILE, { name: "Filter", parts: SELECTED }, { author: "human", engine: inProcessEngine as never })
    const [made, sheet] = [await read(FILE), await read(SHEET)]
    expect(entry.file).toBe(FILE)
    expect(entry.also?.map((change) => change.file)).toEqual([SHEET])
    expect(entry.summary).toBe("make sub-sheet Filter (Filter1) from R5, C3, R6")
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
    await updateAnnotations(root, FILE, (a) => lockParts(a, analyzeCircuit(CUT_MAIN), ["R6"], "2026-11-10T00:00:00Z"))
    await expect(makeSubSheet(root, FILE, { name: "Filter", parts: SELECTED }, { author: "human", engine: inProcessEngine as never })).rejects.toThrow(/R6 is locked/)
    await updateAnnotations(root, FILE, (a) => unlockParts(a, ["R6"]))
    await writeFile(join(root, SHEET), "old")
    await expect(makeSubSheet(root, FILE, { name: "Filter", parts: SELECTED }, { author: "human", engine: inProcessEngine as never })).rejects.toThrow(/Filter\.sheet\.tsx already exists/)
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
        "Change c0001: wrote Filter.sheet.tsx; Filter1 Filter base 100 replaces 3 parts",
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

describe("the board after a cut", () => {
  const LAYOUT = "main.circuit.layout.json"
  const flat = (name: string) => ({ R5: "R105", C3: "C103", R6: "R106" })[name] ?? name
  const flatPin = (pin: string) => pin.replace(/^[^.]+/, flat)
  /** A pad-free stub far from every part, so its net is the one it names. */
  const stub = (id: string, net: string, y: number): TrackRecord => ({ t: "track", id, net, layer: "top", width: 0.25, points: [{ x: 18, y }, { x: 19, y }], locked: false, by: "human" })
  const board = async () => {
    const design = await inProcessEngine.build(root, FILE)
    const nets = new Map(design.circuit.nets.map((net) => [net.id, net]))
    return {
      design,
      places: Object.fromEntries(design.pcb.parts.map((part) => [flat(part.component), [part.x, part.y, part.rotation]])),
      copper: Object.fromEntries(design.pcb.tracks.map((track) => [track.id, (nets.get(track.net ?? "")?.pins ?? []).map(flatPin).sort().join(" ")])),
      names: design.circuit.nets.filter((net) => net.pins.length > 1).map((net) => `${net.pins.map(flatPin).sort().join(" ")}: ${net.names.join(" ")}`).sort(),
    }
  }

  beforeEach(async () => {
    const placed = CUT_MAIN.replace(`<resistor name="R7" resistance="2k" schX={10} schY={1} />`, `<resistor name="R7" resistance="2k" schX={10} schY={1} pcbX={12} pcbY={4} />`)
      .replace(`<resistor name="R8" resistance="2k" schX={10} schY={3} />`, `<resistor name="R8" resistance="2k" schX={10} schY={3} pcbX={12} pcbY={8} />`)
      .replace(`<trace from="R5.pin1" to="net.VIN" />`, `<trace from="R5.pin1" to="net.VIN" />\n    <trace from="R5.pin2" to="net.FB" />`)
    await writeFile(join(root, FILE), placed)
    const records = [stub("t0001", "VIN", 1), stub("t0002", "net:C3.pin2", 3), stub("t0003", "FB", 5), stub("t0004", "net.D1", 7)]
    await writeFile(join(root, LAYOUT), serializeLayout({ next: { track: 5, via: 1 }, records }))
  })

  test("nothing moves, every net keeps its pins, and the copper keeps its nets with no unknown net", async () => {
    const before = await board()
    const texts = [await read(FILE), await read(LAYOUT)]
    const { entry } = await makeSubSheet(root, FILE, { name: "Filter", parts: SELECTED }, { author: "human", engine: inProcessEngine as never })
    expect(entry.also?.map((change) => change.file)).toEqual([SHEET, LAYOUT])
    expect(await read(LAYOUT)).toContain(`"id":"t0002","net":"C3_pin2"`)
    expect(await read(LAYOUT)).toContain(`"id":"t0003","net":"Filter1/FB"`)
    const after = await board()
    expect(after.design.diagnostics.filter((d) => d.code === "unknown-net" || d.severity === "error")).toEqual([])
    expect(after.places).toEqual(before.places)
    expect(after.copper).toEqual(before.copper)
    expect(before.copper).toEqual({ t0001: "R105.pin1 R7.pin1", t0002: "C103.pin2 R7.pin2", t0003: "C103.pin1 R105.pin2", t0004: "R106.pin1 R8.pin1" })
    expect(Object.keys(before.places).sort()).toEqual(["C103", "R105", "R106", "R7", "R8"])
    expect(before.names).toEqual([
      "C103.pin1 R105.pin2: FB",
      "C103.pin2 R7.pin2: ",
      "R105.pin1 R7.pin1: VIN",
      "R106.pin1 R8.pin1: D1",
    ])
    expect(after.names).toEqual([
      "C103.pin1 R105.pin2: Filter1/FB",
      "C103.pin2 R7.pin2: C3_pin2",
      "R105.pin1 R7.pin1: VIN",
      "R106.pin1 R8.pin1: D1",
    ])
    await undoChange(root, { author: "human" })
    expect([await read(FILE), await read(LAYOUT), await exists(SHEET)]).toEqual([...texts, false])
  })
})

describe("layout net renaming", () => {
  test("an unnamed net inside takes its first pin's new designator, a power name stays, a net the cut misses stays", () => {
    const nets = [
      { id: "net:C3.pin1", names: [], pins: ["C3.pin1", "R5.pin2"] },
      { id: "net.GND", names: ["GND"], pins: ["R5.pin1", "R9.pin1"] },
      { id: "net.X", names: ["X"], pins: ["R9.pin2"] },
    ]
    const rename = layoutNetRenamer(nets, { parts: [], mapping: [{ from: "C3", to: "C1" }, { from: "R5", to: "R1" }], crossings: [] }, "Filter1", 100)
    expect(["net:C3.pin1", "GND", "X", "nope"].map(rename)).toEqual(["net:C101.pin1", "GND", "X", "nope"])
  })
})
