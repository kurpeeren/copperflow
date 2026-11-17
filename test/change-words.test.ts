import { describe, expect, test } from "vitest"
import { changeLines, changeTitle, fileCounts, MAX_CHANGE_LINES } from "../src/core/change-words.js"
import { diffDesigns, type DesignDiff, type PartAt } from "../src/engine/design-diff.js"

const part = (name: string, x: number, y: number, value?: string, footprint?: string): PartAt => ({
  name,
  x,
  y,
  rotation: 0,
  side: "top",
  courtyard: [],
  ...(value ? { value } : {}),
  ...(footprint ? { footprint } : {}),
})
const empty = diffDesigns({ error: "" }, { error: "" })
const blank: DesignDiff = { ...empty, failed: undefined } as DesignDiff
delete (blank as { failed?: unknown }).failed

const diff: DesignDiff = {
  ...blank,
  parts: {
    added: [part("R3", 0, -3, "4.7k", "0402")],
    removed: [part("R2", 0, 3, "10k", "0603")],
    moved: [{ name: "R1", from: part("R1", -4, 0), to: { ...part("R1", -6, 0), rotation: 90 } }],
    changed: [{ name: "R1", field: "value", from: "1k", to: "2k" }],
    renamed: [{ from: "R5", to: "R6", at: part("R6", 1, 1) }],
  },
  nets: { appeared: ["SDA"], went: ["OLD"], joined: [{ pin: "R3.pin1", net: "GND" }, { pin: "U1.pin4", net: "GND" }], left: [{ pin: "R2.pin1", net: "VCC" }] },
  tracks: {
    added: [{ id: "t0002", layer: "top", width: 0.25, points: [{ x: -5, y: 0 }, { x: 3, y: 0 }], length: 8 }],
    removed: [{ id: "t0001", layer: "top", width: 0.25, points: [{ x: -3, y: 0 }, { x: 3, y: 0 }], length: 6 }],
  },
  vias: { added: [{ id: "v0001", at: { x: 0, y: -2 }, diameter: 0.6 }], removed: [] },
  pours: { added: [], removed: [{ id: "copperpour:1", net: "GND", layer: "top" }] },
  board: { size: { from: "20 x 10 mm", to: "22 x 10 mm" }, outline: true, layers: { from: 2, to: 4 }, holes: { added: [{ id: "hole:1", x: 8, y: 4, diameter: 1, source: { file: "a", line: 1, column: 1, offset: 0 } }], removed: [] } },
  rules: [{ path: "fabrication.filletRadius", from: "0.5", to: "1.016" }],
  checks: {
    appeared: [
      { id: "e", severity: "error", message: "Short between GND and VCC", at: { x: 1, y: 2 } },
      { id: "w", severity: "warning", message: "R3 is close to the edge" },
    ],
    went: [{ id: "g", severity: "error", message: "R2 overlaps C1" }],
  },
  schematic: { moved: ["R1"] },
}

describe("a change in words", () => {
  test("the title of one change and of everything since one", () => {
    const entry = { id: "c0004", author: "ai" as const, summary: "edit set R1 pcbX=-6" }
    expect(changeTitle({ id: "c0004" }, [entry])).toBe("Change c0004 by the agent: edit set R1 pcbX=-6")
    expect(changeTitle({ id: "c0004" }, [{ ...entry, author: "human" }])).toBe("Change c0004 by the person: edit set R1 pcbX=-6")
    const since = [entry, { ...entry, id: "c0005" }, { ...entry, id: "c0006", author: "human" as const }]
    expect(changeTitle({ since: "c0003" }, since)).toBe("Since c0003: 3 changes, c0004 to c0006 (2 by the agent, 1 by the person)")
    expect(changeTitle({ since: "c0003" }, [])).toBe("Since c0003: no changes")
  })

  test("the important first: errors that appeared, parts removed, nets changed, then moves and copper as counts", () => {
    const lines = changeLines({ title: "Change c0004 by the agent: x", diff, unsure: [], files: [] }).map((line) => line.text)
    expect(lines).toEqual([
      "Change c0004 by the agent: x",
      "New error: Short between GND and VCC",
      "Removed R2 (10k, 0603)",
      "Added R3 (4.7k, 0402)",
      "Renamed R5 to R6",
      "New net SDA",
      "Net OLD is gone",
      "GND: R3.pin1, U1.pin4 joined",
      "VCC: R2.pin1 left",
      "R1 value 1k to 2k",
      "Board 20 x 10 mm to 22 x 10 mm",
      "Board 2 to 4 layers",
      "Holes: 1 added",
      "Rule fabrication.filletRadius: 0.5 to 1.016",
      "New warning: R3 is close to the edge",
      "Check gone: R2 overlaps C1",
      "Moved 1 part: R1",
      "Tracks: 1 added (8 mm), 1 removed (6 mm)",
      "Vias: 1 added",
      "Pours: 1 removed",
      "Schematic: 1 symbol moved (R1)",
    ])
  })

  test("lines that point at a place carry it, for the view to centre on", () => {
    const lines = changeLines({ title: "t", diff, unsure: [], files: [] })
    expect(lines.find((line) => line.text.startsWith("Removed R2"))?.at).toEqual({ x: 0, y: 3 })
    expect(lines.find((line) => line.text.startsWith("Moved"))?.at).toEqual({ x: -6, y: 0 })
    expect(lines.find((line) => line.text.startsWith("New error"))?.at).toEqual({ x: 1, y: 2 })
    expect(lines.find((line) => line.text.startsWith("Tracks"))?.at).toEqual({ x: -1, y: 0 })
  })

  test("at most 30 lines, ending with what was left out as counts", () => {
    const many: DesignDiff = { ...blank, parts: { ...blank.parts, removed: Array.from({ length: 40 }, (_, i) => part(`R${i + 1}`, i, 0)) }, checks: { appeared: [], went: Array.from({ length: 5 }, (_, i) => ({ id: `g${i}`, severity: "warning" as const, message: `gone ${i}` })) } }
    const lines = changeLines({ title: "t", diff: many, unsure: [], files: [] }).map((line) => line.text)
    expect(MAX_CHANGE_LINES).toBe(30)
    expect(lines).toHaveLength(30)
    expect(lines[28]).toBe("Removed R28")
    expect(lines[29]).toBe("Left out: 12 parts removed, 5 checks gone")
  })

  test("a side that did not build is named first, with the files the text shows changed; a file edited by hand is named", () => {
    const failed = diffDesigns({ error: "x" }, { error: "Unexpected token (3:5)" })
    const files = fileCounts({ "a.circuit.tsx": "a\nb\n" }, { "a.circuit.tsx": "a\nc\nd\n", "b.ts": "x\n" }, ["a.circuit.tsx", "b.ts"])
    const lines = changeLines({ title: "t", diff: { ...failed, failed: { side: "after", message: "Unexpected token (3:5)" } }, unsure: ["a.circuit.tsx"], files }).map((line) => line.text)
    expect(lines).toEqual([
      "t",
      "After the change the circuit code does not build: Unexpected token (3:5)",
      "Not sure of a.circuit.tsx: it was edited by hand between changes",
      "File a.circuit.tsx: 2 lines added, 1 removed",
      "File b.ts: new, 1 line",
    ])
    const both = changeLines({ title: "t", diff: { ...failed, failed: { side: "both", message: "m" } }, unsure: [], files: [] }).map((line) => line.text)
    expect(both[1]).toBe("Before and after the change the circuit code does not build: m")
  })

  test("a change to the schematic only says nothing on the board changed; no difference at all says so", () => {
    const sheet = changeLines({ title: "t", diff: { ...blank, schematic: { moved: ["R1", "R2"] } }, unsure: [], files: [] }).map((line) => line.text)
    expect(sheet).toEqual(["t", "Nothing on the board changed", "Schematic: 2 symbols moved (R1, R2)"])
    const none = changeLines({ title: "t", diff: blank, unsure: [], files: fileCounts({ "a.ts": "x" }, { "a.ts": "y" }, ["a.ts"]) }).map((line) => line.text)
    expect(none).toEqual(["t", "No difference in the built design", "File a.ts: 1 line added, 1 removed"])
  })
})
