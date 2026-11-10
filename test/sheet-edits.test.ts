import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { applyEdits } from "../src/core/edit.js"
import { lockedStart, withInstanceParts } from "../src/core/layout-locks.js"
import { editCircuit, listCircuits, listSheets, undoChange } from "../src/core/workspace.js"
import type { TrackRecord } from "../src/core/layout-file.js"

const none = new Set<string>()

const SHEET = `export default function PowerStage() {
  return (
    <sheet>
      <port name="VIN" />
      <port name="VOUT" side="right" />
      <resistor name="R1" />
      <trace from="R1.pin1" to="net.VIN" />
      <trace from="R1.pin2" to="net.VOUT" />
    </sheet>
  )
}
`

const MAIN = `import PowerStage from "./PowerStage.sheet"
export default () => (
  <board width="20mm" height="20mm">
    <PowerStage name="PS1" connections={{ VIN: "VBUS" }} schX={2} schY={0} />
  </board>
)
`

describe("edits in a sheet file", () => {
  test("a port's side, order and bus flag are its props", () => {
    const next = applyEdits(SHEET, [{ kind: "setProps", part: "VIN", props: { side: "top", order: 2 } }], none)
    expect(next).toContain(`<port name="VIN" side="top" order={2} />`)
  })

  test("renaming a port renames its local net in the sheet's traces", () => {
    const next = applyEdits(SHEET, [{ kind: "renamePort", from: "VIN", to: "VSUP" }], none)
    expect(next).toContain(`<port name="VSUP" />`)
    expect(next).toContain(`<trace from="R1.pin1" to="net.VSUP" />`)
    expect(next).toContain(`<trace from="R1.pin2" to="net.VOUT" />`)
    expect(() => applyEdits(SHEET, [{ kind: "renamePort", from: "VIN", to: "R1" }], none)).toThrow(/already the name/)
    expect(() => applyEdits(SHEET, [{ kind: "renamePort", from: "VIN", to: "bad name" }], none)).toThrow(/not a net name/)
    expect(() => applyEdits(SHEET, [{ kind: "renamePort", from: "R1", to: "X" }], none)).toThrow(/No port named R1/)
  })

  test("a bus port takes a bus name", () => {
    const bussed = SHEET.replace(`<port name="VIN" />`, `<port name="D[0:3]" bus />`)
    expect(applyEdits(bussed, [{ kind: "renamePort", from: "D[0:3]", to: "A[0:7]" }], none)).toContain(`<port name="A[0:7]" bus />`)
  })

  test("the symbol size is set on <sheet>, and null removes it", () => {
    const sized = applyEdits(SHEET, [{ kind: "setSheetSize", width: 3, height: 2.4 }], none)
    expect(sized).toContain(`<sheet width={3} height={2.4}>`)
    expect(applyEdits(sized, [{ kind: "setSheetSize", width: null }], none)).toContain(`<sheet height={2.4}>`)
    expect(() => applyEdits(SHEET, [{ kind: "setSheetSize", width: 0 }], none)).toThrow(/above 0/)
    expect(() => applyEdits(MAIN, [{ kind: "setSheetSize", width: 3 }], none)).toThrow(/no <sheet>/)
  })

  test("parts and traces are added inside <sheet>, as on a board", () => {
    const next = applyEdits(SHEET, [{ kind: "addPart", tag: "capacitor", name: "C1" }, { kind: "addTrace", from: "C1.pin1", to: "net.VIN" }], none)
    expect(next).toContain(`      <capacitor name="C1" />\n      <trace from="R1.pin1" to="net.VIN" />`)
    expect(next).toContain(`      <trace from="C1.pin1" to="net.VIN" />\n    </sheet>`)
  })
})

describe("an instance's connections", () => {
  test("are written whole as an object, a bus port's name quoted", () => {
    const next = applyEdits(MAIN, [{ kind: "setConnections", part: "PS1", connections: { VIN: "V5", "D[0:3]": "D[0:3]" } }], none)
    expect(next).toContain(`connections={{ VIN: "V5", "D[0:3]": "D[0:3]" }}`)
    expect(() => applyEdits(MAIN, [{ kind: "setConnections", part: "PS1", connections: { VIN: "a b" } }], none)).toThrow(/net name/)
    expect(() => applyEdits(MAIN, [{ kind: "setConnections", part: "PS1", connections: { VIN: "V5" } }], new Set(["PS1"]))).toThrow(/locked/)
  })
})

describe("the workspace", () => {
  test("a sheet file is edited as a circuit is: one history entry naming it, undone by file match", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-sheet-"))
    await writeFile(join(root, "main.circuit.tsx"), MAIN)
    await writeFile(join(root, "PowerStage.sheet.tsx"), SHEET)
    expect(await listCircuits(root)).toEqual(["main.circuit.tsx"])
    expect(await listSheets(root)).toEqual(["PowerStage.sheet.tsx"])
    const result = await editCircuit(root, "PowerStage.sheet.tsx", [{ kind: "setProps", part: "VOUT", props: { order: 3 } }], { author: "human", summary: "Move VOUT" })
    expect(result.entry.file).toBe("PowerStage.sheet.tsx")
    expect(await readFile(join(root, "main.circuit.tsx"), "utf8")).toBe(MAIN)
    const undo = await undoChange(root, { author: "human" })
    expect(undo.file).toBe("PowerStage.sheet.tsx")
    expect(await readFile(join(root, "PowerStage.sheet.tsx"), "utf8")).toBe(SHEET)
  })
})

describe("locks", () => {
  const instances = [
    { path: "PS1", parts: ["R101", "R102"] },
    { path: "PS1/D1", parts: ["R201"] },
    { path: "PS2", parts: ["R301"] },
  ]

  test("a locked instance locks all its parts, those of the instances inside it too", () => {
    expect([...withInstanceParts(new Set(["PS1", "R1"]), instances)].sort()).toEqual(["PS1", "R1", "R101", "R102", "R201"])
    expect([...withInstanceParts(new Set(["R1"]), instances)]).toEqual(["R1"])
  })

  test("a track starting on a pad of a locked instance's part counts as locked", () => {
    const pad = { id: "R101#1", component: "R101", number: "1", x: 1, y: 1, width: 1, height: 1, rotation: 0, layers: "top", shape: "rect" }
    const design = { pcb: { parts: [{ component: "R101", pads: [pad] }] }, circuit: { instances } } as never
    const track: TrackRecord = { t: "track", id: "t0001", layer: "top", width: 0.2, points: [{ x: 1, y: 1 }, { x: 5, y: 1 }], locked: false, by: "human" }
    expect(lockedStart(new Set(["PS1"]), design)(track)).toBe("R101")
    expect(lockedStart(new Set(["PS2"]), design)(track)).toBeUndefined()
  })
})

describe("Replicate layout's one history entry", () => {
  test("the copper in the layout file and the placement in the sheet file are one entry, undone together", async () => {
    const { applyLayoutEdits } = await import("../src/core/layout-edits.js")
    const root = await mkdtemp(join(tmpdir(), "cf-replicate-"))
    await writeFile(join(root, "main.circuit.tsx"), MAIN)
    await writeFile(join(root, "PowerStage.sheet.tsx"), SHEET)
    const track = { kind: "addTrack" as const, layer: "top" as const, width: 0.2, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }
    const sheet = { file: "PowerStage.sheet.tsx", edits: [{ kind: "setProps" as const, part: "R1", props: { pcbX: 1, pcbY: 2 } }] }
    const result = await applyLayoutEdits(root, "main.circuit.tsx", [track], { author: "human", summary: "Replicate", sheet })
    expect(result.entry.file).toBe("main.circuit.layout.json")
    expect(result.entry.also?.map((change) => change.file)).toEqual(["PowerStage.sheet.tsx"])
    expect(await readFile(join(root, "PowerStage.sheet.tsx"), "utf8")).toContain(`<resistor name="R1" pcbX={1} pcbY={2} />`)
    await undoChange(root, { author: "human" })
    expect(await readFile(join(root, "PowerStage.sheet.tsx"), "utf8")).toBe(SHEET)
  })
})
