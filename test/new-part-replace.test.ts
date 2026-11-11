// Replacing an imported part with the wizard or create_part: keeping its footprint.yaml keeps the import (origin and
// source.md); replacing the footprint makes the part written and removes the imported data. Never the network.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { access, mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readPart } from "../src/core/library.js"
import { importLcscPart } from "../src/library/import-lcsc.js"
import { ORIENTATION_NOTE } from "../src/library/lcsc-part.js"
import { formatNewPart, writeNewPart, type NewPartInput } from "../src/library/new-part.js"
import { fixtureFetch, noNetwork } from "./helpers/lcsc-fixtures.js"

const IMPORTED = "2026-11-11T09:30:00.000Z"
const LATER = "2026-11-12T10:00:00.000Z"
const ID = "LM358DR2G"
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-replace-"))
  vi.stubGlobal("fetch", noNetwork)
  await importLcscPart(root, "C7950", { now: IMPORTED, fetch: fixtureFetch() })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const file = (name: string) => readFile(join(root, "parts", ID, name), "utf8")
const exists = (name: string) =>
  access(join(root, "parts", ID, name)).then(
    () => true,
    () => false,
  )

/** The imported part's pins with real types, as the skill reference says to fix them. */
async function typedPins(): Promise<NewPartInput["pins"]> {
  const { pins } = await readPart(root, ID)
  const types: Record<string, string> = { "4": "ground", "8": "power_in", "2": "input", "3": "input", "5": "input", "6": "input", "1": "output", "7": "output" }
  return Object.fromEntries(Object.entries(pins).map(([number, pin]) => [number, { ...pin, type: types[number] ?? pin.type }])) as NewPartInput["pins"]
}

describe("replacing an imported part", () => {
  test("package footprint.yaml without new pads keeps the imported pads, origin and source.md, and says so", async () => {
    const footprint = await file("footprint.yaml")
    const source = await file("source.md")
    const result = await writeNewPart(root, { id: ID, title: "LM358 dual op-amp, SOIC-8", package: { file: "footprint.yaml" }, pins: await typedPins() }, { now: LATER, replace: true })
    expect(await file("footprint.yaml")).toBe(footprint)
    expect(await file("source.md")).toBe(source)
    const part = await readPart(root, ID)
    expect(part.origin).toBe("lcsc C7950, imported 2026-11-11")
    expect(part.pins["8"]?.type).toBe("power_in")
    expect(result.notes[0]).toBe("Kept footprint.yaml, the origin (lcsc C7950, imported 2026-11-11) and source.md from the import: the part still uses EasyEDA's footprint.")
    expect(result.notes).toContain(ORIENTATION_NOTE)
    expect(result.notes.some((note) => note.includes("placeholder"))).toBe(false)
    expect(formatNewPart(result)).toContain("Note: Kept footprint.yaml")
    expect(await file("verification.md")).toContain("- [ ] Kept footprint.yaml")
  })

  test("a footprint string replaces the footprint: origin written, source.md and the imported footprint.yaml removed", async () => {
    const result = await writeNewPart(root, { id: ID, title: "LM358 dual op-amp, SOIC-8", package: "soic8", pins: await typedPins() }, { now: LATER, replace: true })
    expect((await readPart(root, ID)).origin).toBe("written 2026-11-12")
    expect(await exists("source.md")).toBe(false)
    expect(await exists("footprint.yaml")).toBe(false)
    expect(result.notes).toEqual(["Removed source.md and the imported footprint.yaml: the part no longer uses EasyEDA's data."])
    expect(formatNewPart(result)).toContain("Note: Removed source.md and the imported footprint.yaml")
  })

  test("new pads for footprint.yaml replace the footprint: origin written, source.md removed", async () => {
    const pads = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ number: String(n), shape: "rect" as const, x: n <= 4 ? -2.7 : 2.7, y: n <= 4 ? (n - 2.5) * 1.27 : (6.5 - n) * 1.27, width: 1.55, height: 0.6 }))
    const result = await writeNewPart(root, { id: ID, title: "LM358", package: { file: "footprint.yaml" }, pins: await typedPins(), footprintFile: { pads } }, { now: LATER, replace: true })
    expect((await readPart(root, ID)).origin).toBe("written 2026-11-12")
    expect(await exists("source.md")).toBe(false)
    expect(await file("footprint.yaml")).toContain("width: 1.55")
    expect(result.notes).toEqual(["Removed source.md and replaced the imported footprint.yaml: the part no longer uses EasyEDA's data."])
  })

  test("a refused replace leaves the import as it was", async () => {
    const before = await Promise.all(["part.yaml", "footprint.yaml", "source.md"].map(file))
    await expect(writeNewPart(root, { id: ID, title: "LM358", package: "soic14", pins: await typedPins() }, { now: LATER, replace: true })).rejects.toThrow(/does not fit the pins/)
    expect(await Promise.all(["part.yaml", "footprint.yaml", "source.md"].map(file))).toEqual(before)
  })
})

describe("replacing a written part with its own footprint.yaml", () => {
  test("drawn pads are kept when the replace gives none; the origin becomes the new written date", async () => {
    const pads = [1, 2].map((n) => ({ number: String(n), shape: "rect" as const, x: n === 1 ? -1 : 1, y: 0, width: 1, height: 1.2 }))
    await writeNewPart(root, { id: "R1", title: "Resistor", package: { file: "footprint.yaml" }, pins: "1 A passive\n2 B passive", footprintFile: { pads } }, { now: IMPORTED })
    const drawn = await readFile(join(root, "parts", "R1", "footprint.yaml"), "utf8")
    const result = await writeNewPart(root, { id: "R1", title: "Resistor 0805", package: { file: "footprint.yaml" }, pins: "1 A passive\n2 B passive" }, { now: LATER, replace: true })
    expect(await readFile(join(root, "parts", "R1", "footprint.yaml"), "utf8")).toBe(drawn)
    expect((await readPart(root, "R1")).origin).toBe("written 2026-11-12")
    expect(result.notes).toEqual(["Kept footprint.yaml: its pads were drawn before and none were given."])
  })
})
