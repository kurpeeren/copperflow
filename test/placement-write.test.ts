import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { lockParts } from "../src/core/annotations.js"
import { readEntries } from "../src/core/history.js"
import { placementWrites, writePlacement } from "../src/core/placement-write.js"
import { loadCircuit, undoChange, updateAnnotations } from "../src/core/workspace.js"
import { buildDesign, type Design } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { placeBoard, type PlacedPosition } from "../src/engine/pcb-place/index.js"
import { collectProjectFiles } from "../src/engine/project-files.js"

const MAIN = "main.circuit.tsx"
const SHEET = "Stage.sheet.tsx"
const STAGE = `export default function Stage() {
  return (
    <sheet>
      <port name="VIN" />
      <port name="GND" />
      <resistor name="R1" resistance="1k" footprint="0603" />
      <capacitor name="C1" capacitance="1uF" footprint="0603" />
      <trace from="R1.pin1" to="net.VIN" />
      <trace from="R1.pin2" to="C1.pin1" />
      <trace from="C1.pin2" to="net.GND" />
    </sheet>
  )
}
`
const circuit = (instances: string) => `import Stage from "./Stage.sheet"
export default () => (
  <board width="40mm" height="30mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-10} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0603" />
    <group pcbX={5} pcbY={2}>
      <capacitor name="C1" capacitance="1uF" footprint="0603" />
    </group>
${instances}
    <trace from="R1.pin1" to="net.VBUS" />
    <trace from="R1.pin2" to="R2.pin1" />
    <trace from="R2.pin2" to="C1.pin1" />
    <trace from="C1.pin2" to="net.GND" />
  </board>
)
`
const ONE = `    <Stage name="S1" connections={{ VIN: "VBUS", GND: "GND" }} pcbX={8} pcbY={-6} pcbRotation={90} />`
const TWO = `${ONE}\n    <Stage name="S2" connections={{ VIN: "VBUS", GND: "GND" }} pcbX={-8} pcbY={8} />`

let root: string
const build = async (): Promise<Design> => buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), MAIN)
const partAt = (design: Design, name: string) => {
  const part = design.pcb.parts.find((p) => p.component === name)
  if (!part) throw new Error(`no part ${name}`)
  return { x: part.x, y: part.y, rotation: part.rotation, autoPlaced: part.autoPlaced }
}

async function project(instances = ONE): Promise<void> {
  root = await mkdtemp(join(tmpdir(), "cf-place-write-"))
  await writeFile(join(root, MAIN), circuit(instances))
  await writeFile(join(root, SHEET), STAGE)
}

beforeEach(() => project())

describe("placementWrites", () => {
  test("gives each part the props that put it where the placer said: less its group, and inside an instance turned back into the sheet's frame", async () => {
    const design = await build()
    const positions = new Map<string, PlacedPosition>([
      ["R2", { x: 3, y: 4, rotation: 90 }],
      ["C1", { x: 7.5, y: 1, rotation: 0 }],
      ["R101", { x: 10, y: -3, rotation: 180 }],
    ])
    const writes = placementWrites(design, positions)
    expect(writes.circuit).toEqual([
      { kind: "setProps", part: "C1", props: { pcbX: 2.5, pcbY: -1, pcbRotation: 0 } },
      { kind: "setProps", part: "R2", props: { pcbX: 3, pcbY: 4, pcbRotation: 90 } },
    ])
    // S1 sits at (8, -6) turned 90°: (10, -3) is (2, 3) from it, which is (3, -2) in the sheet's frame.
    expect(writes.sheets).toEqual([{ file: SHEET, edits: [{ kind: "setProps", part: "R1", props: { pcbX: 3, pcbY: -2, pcbRotation: 90 } }], parts: ["R101"] }])
    expect(writes.notes).toEqual([])
  })

  test("a sheet holds one position per part: a second instance's part is left out with a note", async () => {
    await project(TWO)
    const design = await build()
    const writes = placementWrites(design, new Map([["R101", { x: 10, y: -3, rotation: 0 }], ["R201", { x: -6, y: 8, rotation: 0 }]]))
    expect(writes.sheets[0]?.edits).toHaveLength(1)
    expect(writes.notes).toEqual(["R201 was not written: it is R1 of Stage.sheet.tsx, whose position R101 (S1) gives every instance"])
  })
})

describe("writePlacement", () => {
  test("writes the placement as one history entry, the sheet file with it; the board rebuilds with each part where the placer put it, and undo takes it all back", async () => {
    const before = { circuit: await readFile(join(root, MAIN), "utf8"), sheet: await readFile(join(root, SHEET), "utf8") }
    const design = await build()
    const placement = placeBoard(design)
    expect(placement.positions.size).toBe(4)
    const written = await writePlacement(root, MAIN, placementWrites(design, placement.positions), { author: "human", summary: "Autoplace the board: 4 parts" })
    expect(written.written).toEqual(["C1", "C101", "R2", "R101"])
    const entries = await readEntries(root)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ author: "human", file: MAIN, summary: "Autoplace the board: 4 parts" })
    expect(entries[0]?.also?.map((change) => change.file)).toEqual([SHEET])
    const after = await build()
    for (const [name, at] of placement.positions) {
      const now = partAt(after, name)
      expect(now.autoPlaced).toBe(false)
      expect(now.x).toBeCloseTo(at.x, 6)
      expect(now.y).toBeCloseTo(at.y, 6)
      expect(now.rotation).toBe(at.rotation)
    }
    await undoChange(root, { author: "human" })
    expect(await readFile(join(root, MAIN), "utf8")).toBe(before.circuit)
    expect(await readFile(join(root, SHEET), "utf8")).toBe(before.sheet)
  })

  test("a part locked before the write is left where it is and named", async () => {
    const design = await build()
    const placement = placeBoard(design)
    const { model } = await loadCircuit(root, MAIN)
    await updateAnnotations(root, MAIN, (a) => lockParts(a, model, ["R2"], new Date().toISOString()))
    const written = await writePlacement(root, MAIN, placementWrites(design, placement.positions), { author: "ai", summary: "Autoplace the board" })
    expect(written.written).not.toContain("R2")
    expect(written.skipped).toEqual(["R2 is locked"])
    expect(await readFile(join(root, MAIN), "utf8")).toContain(`<resistor name="R2" resistance="1k" footprint="0603" />`)
  })

  test("the guard runs first and stops the write", async () => {
    const design = await build()
    const writes = placementWrites(design, placeBoard(design).positions)
    await expect(writePlacement(root, MAIN, writes, { author: "human", summary: "x", guard: async () => Promise.reject(new Error("changed")) })).rejects.toThrow("changed")
    expect(await readEntries(root)).toEqual([])
  })

  test("with fit, the board is reshaped round the placed parts in the same entry", async () => {
    const design = await build()
    const written = await writePlacement(root, MAIN, placementWrites(design, placeBoard(design).positions), { author: "ai", summary: "Autoplace", fit: { margin: 2 } })
    expect(await readEntries(root)).toHaveLength(1)
    expect(written.board).toMatchObject({ width: expect.any(Number), height: expect.any(Number) })
    const board = (await build()).pcb.board?.outline ?? []
    const width = Math.max(...board.map((p) => p.x)) - Math.min(...board.map((p) => p.x))
    expect(width).toBeCloseTo((written.board as { width: number }).width, 6)
    expect(width).toBeLessThan(40)
  })
})
