import { describe, expect, test } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { analyzeCircuit } from "../src/core/analyze.js"
import { generateCircuit } from "../src/core/new-circuit.js"
import { placeEdit } from "../src/core/place.js"
import { elaborate } from "../src/engine/elaborate.js"
import { evaluateCircuit } from "../src/engine/evaluate.js"

const FILE = "power.circuit.tsx"
const root = () => mkdtemp(join(tmpdir(), "cf-pages-"))

const parts = [
  { name: "J1", kind: "connector", props: { pinCount: 2 } },
  { name: "C1", kind: "capacitor", value: "10uF" },
  { name: "R1", kind: "resistor", value: "10k" },
]
const nets = { VBUS: ["J1.pin1", "C1.pin1", "R1.pin1"], GND: ["J1.pin2", "C1.pin2"] }

describe("new_circuit with pages", () => {
  test("writes each page once, in order, with its parts and their traces; the rest is on Main", async () => {
    const { text } = await generateCircuit(await root(), FILE, { parts, nets, pages: [{ name: "Power", parts: ["C1"] }, { name: "IO", parts: ["J1"] }] })
    const circuit = elaborate(evaluateCircuit({ [FILE]: text }, FILE), FILE, { padCount: () => undefined })
    expect(circuit.pages).toEqual(["Main", "Power", "IO"])
    expect(Object.fromEntries(circuit.components.map((c) => [c.id, c.page ?? "Main"]))).toEqual({ J1: "IO", C1: "Power", R1: "Main" })
    expect(circuit.connections.filter((c) => c.from.startsWith("C1.")).map((c) => c.page)).toEqual(["Power", "Power"])
    expect(circuit.nets.find((n) => n.id === "net.VBUS")?.pins).toEqual(["C1.pin1", "J1.pin1", "R1.pin1"])
    expect(circuit.diagnostics.filter((d) => d.severity === "error")).toEqual([])
  })

  test("refuses an unknown part, a part on two pages, a bad name and Main", async () => {
    const dir = await root()
    const make = (pages: { name: string; parts: string[] }[]) => generateCircuit(dir, FILE, { parts, nets, pages })
    await expect(make([{ name: "Power", parts: ["X9"] }])).rejects.toThrow(/there is no part X9/)
    await expect(make([{ name: "A", parts: ["C1"] }, { name: "B", parts: ["C1"] }])).rejects.toThrow(/on both page A and page B/)
    await expect(make([{ name: "<bad>", parts: [] }])).rejects.toThrow(/not a page name/)
    await expect(make([{ name: "Main", parts: ["C1"] }])).rejects.toThrow(/leave Main out/)
    await expect(make([{ name: "A", parts: [] }, { name: "A", parts: [] }])).rejects.toThrow(/Two pages are named A/)
  })
})

describe("place_part with a page", () => {
  test("the edit carries the page", async () => {
    const dir = await root()
    await writeFile(join(dir, FILE), "export default () => <board width=\"10mm\" height=\"10mm\">\n</board>\n")
    const model = analyzeCircuit("export default () => <board />")
    const { edit } = await placeEdit(dir, { file: FILE, model }, { part: "resistor", page: "Power" })
    expect(edit).toEqual({ kind: "addPart", tag: "resistor", name: "R1", page: "Power" })
  })
})
