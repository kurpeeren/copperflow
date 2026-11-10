import { beforeEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { lockParts } from "../src/core/annotations.js"
import { listEntries } from "../src/core/history.js"
import { applyLayoutEdits } from "../src/core/layout-edits.js"
import type { LayoutEdit } from "../src/core/layout-records.js"
import { editCircuit, loadCircuit, redoChange, undoChange, updateAnnotations } from "../src/core/workspace.js"
import { buildDesign, type Design } from "../src/engine/design.js"

const FILE = "boards/main.circuit.tsx"
const LAYOUT = "boards/main.circuit.layout.json"
const CIRCUIT = `export default () => (
  <board width="30mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-5} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={5} pcbY={0} />
    <trace from=".R1 > .pin1" to=".R2 > .pin1" />
  </board>
)
`

let root: string
let design: Design

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-layout-"))
  await mkdir(join(root, "boards"))
  await writeFile(join(root, FILE), CIRCUIT)
  design ??= buildDesign({ [FILE]: CIRCUIT }, FILE)
})

const layoutText = () => readFile(join(root, LAYOUT), "utf8")
const pad = (id: string) => {
  const found = design.pcb.parts.flatMap((p) => p.pads).find((p) => p.id === id)
  if (!found) throw new Error(`no pad ${id}`)
  return { x: found.x, y: found.y }
}
const addTrack = (): LayoutEdit => ({ kind: "addTrack", net: "R1.pin1", layer: "top", width: 0.25, points: [pad("R1#1"), pad("R2#1")] })
const human = { author: "human" as const }

describe("applyLayoutEdits", () => {
  test("the first edit creates the layout file as one history entry naming it", async () => {
    const result = await applyLayoutEdits(root, FILE, [addTrack()], human)
    expect(result.created).toEqual(["t0001"])
    expect(result.file).toBe(LAYOUT)
    expect(result.entry).toMatchObject({ file: LAYOUT, author: "human", absent: "before", before: "", summary: "Add track t0001" })
    expect(await layoutText()).toBe(result.entry.after)
    expect(result.records).toHaveLength(1)
  })

  test("later edits change the file in place, and the layout file's own name works too", async () => {
    await applyLayoutEdits(root, FILE, [addTrack()], human)
    const before = await layoutText()
    const result = await applyLayoutEdits(root, LAYOUT, [{ kind: "addVia", at: pad("R2#1"), drill: 0.3, diameter: 0.6 }, { kind: "setTrack", id: "t0001", width: 0.4 }], {
      author: "ai",
    })
    expect(result.entry).toMatchObject({ file: LAYOUT, author: "ai", before, summary: "Add via v0001, change track t0001" })
    expect(result.entry.absent).toBeUndefined()
    expect(result.records.map((r) => [r.id, r.by])).toEqual([["t0001", "human"], ["v0001", "agent"]])
  })

  test("a summary can be given", async () => {
    const result = await applyLayoutEdits(root, FILE, [addTrack()], { author: "human", summary: "Route R1 to R2" })
    expect(result.entry.summary).toBe("Route R1 to R2")
  })

  test("an edit that changes nothing is refused and records nothing", async () => {
    await applyLayoutEdits(root, FILE, [addTrack()], human)
    await expect(applyLayoutEdits(root, FILE, [{ kind: "setTrack", id: "t0001", width: 0.25 }], human)).rejects.toThrow(/no change/)
    expect(await listEntries(root, 10)).toHaveLength(1)
  })

  test("a damaged layout file is refused, naming the file and the line", async () => {
    await writeFile(join(root, LAYOUT), "{oops\n")
    await expect(applyLayoutEdits(root, FILE, [addTrack()], human)).rejects.toThrow(`${LAYOUT}: line 1 is not valid JSON`)
  })

  test("a file that is neither a circuit nor a layout file is refused as an edit error", async () => {
    await expect(applyLayoutEdits(root, "boards/main.tsx", [addTrack()], human)).rejects.toMatchObject({ name: "EditError", code: "invalid" })
  })

  test("removing the highest id does not hand it out again", async () => {
    await applyLayoutEdits(root, FILE, [addTrack(), addTrack()], human)
    await applyLayoutEdits(root, FILE, [{ kind: "removeTrack", id: "t0002" }], human)
    expect((await applyLayoutEdits(root, FILE, [addTrack()], human)).created).toEqual(["t0003"])
  })

  test("a circuit that does not exist is refused", async () => {
    await expect(applyLayoutEdits(root, "boards/none.circuit.tsx", [addTrack()], human)).rejects.toThrow(/does not exist/)
  })

  test("a guard runs in the project queue after the writes queued before it, and a throw writes nothing", async () => {
    const seen: string[] = []
    const slow = applyLayoutEdits(root, FILE, [addTrack()], { author: "human", design: async () => (await new Promise((done) => setTimeout(done, 100)), design) })
    const guarded = applyLayoutEdits(root, FILE, [addTrack()], {
      author: "human",
      design,
      guard: async () => {
        seen.push(await layoutText())
        throw new Error("changed")
      },
    })
    await slow
    await expect(guarded).rejects.toThrow("changed")
    expect(seen).toEqual([await layoutText()])
    expect(seen[0]).toContain('"id":"t0001"')
    expect(await layoutText()).not.toContain('"id":"t0002"')
  })

  test("a locked record is refused", async () => {
    await applyLayoutEdits(root, FILE, [addTrack()], human)
    await applyLayoutEdits(root, FILE, [{ kind: "setTrack", id: "t0001", locked: true }], human)
    await expect(applyLayoutEdits(root, FILE, [{ kind: "removeTrack", id: "t0001" }], { author: "ai" })).rejects.toThrow(/t0001 is locked/)
  })
})

describe("locked parts", () => {
  const lockR1 = async () => {
    const { model } = await loadCircuit(root, FILE)
    await updateAnnotations(root, FILE, (a) => lockParts(a, model, ["R1"], "2026-11-09T10:00:00.000Z"))
  }

  test("a track starting on a locked part's pad cannot change or go", async () => {
    await applyLayoutEdits(root, FILE, [addTrack()], human)
    await lockR1()
    await expect(applyLayoutEdits(root, FILE, [{ kind: "removeTrack", id: "t0001" }], { ...human, design })).rejects.toThrow(
      /t0001 starts on the locked part R1/,
    )
  })

  test("without the built design such an edit is refused rather than guessed", async () => {
    await applyLayoutEdits(root, FILE, [addTrack()], human)
    await lockR1()
    await expect(applyLayoutEdits(root, FILE, [{ kind: "removeTrack", id: "t0001" }], human)).rejects.toThrow(/built design/)
  })

  test("a new track starting on a locked part is refused; one that only ends there is free", async () => {
    await lockR1()
    await expect(applyLayoutEdits(root, FILE, [addTrack()], { ...human, design })).rejects.toThrow(/t0001 starts on the locked part R1/)
    const reversed: LayoutEdit = { kind: "addTrack", layer: "top", width: 0.25, points: [pad("R2#1"), pad("R1#1")] }
    await applyLayoutEdits(root, FILE, [reversed], { ...human, design })
    await expect(applyLayoutEdits(root, FILE, [{ kind: "setTrack", id: "t0001", width: 0.3 }], { ...human, design })).resolves.toBeDefined()
  })

  test("undo of a track on a part locked since is refused, and needs the design to tell", async () => {
    await applyLayoutEdits(root, FILE, [addTrack()], { author: "ai" })
    await lockR1()
    await expect(undoChange(root, { author: "ai", design })).rejects.toThrow(
      "would remove the locked track t0001 (on the locked part R1); unlock it first",
    )
    await expect(undoChange(root, { author: "ai" })).rejects.toThrow(/built design/)
  })

  test("redo that brings back a track on a part locked since is refused", async () => {
    await applyLayoutEdits(root, FILE, [{ kind: "addVia", at: pad("R2#1"), drill: 0.3, diameter: 0.6 }], human)
    await applyLayoutEdits(root, FILE, [addTrack()], human)
    await undoChange(root, { author: "human", design })
    await lockR1()
    await expect(redoChange(root, { author: "human", design })).rejects.toThrow(/Redoing .* would change the locked track t0001 \(on the locked part R1\)/)
  })

  test("the design may be given as a function of the circuit file, asked for only when parts are locked or copper gets a layer", async () => {
    const asked: string[] = []
    const designFor = async (circuit: string) => {
      asked.push(circuit)
      return design
    }
    await applyLayoutEdits(root, FILE, [addTrack(), addTrack()], { ...human, design: designFor })
    expect(asked).toEqual([FILE])
    await applyLayoutEdits(root, FILE, [{ kind: "removeTrack", id: "t0002" }, { kind: "setTrack", id: "t0001", width: 0.3 }], { ...human, design: designFor })
    expect(asked).toEqual([FILE])
    asked.length = 0
    await lockR1()
    await expect(applyLayoutEdits(root, FILE, [{ kind: "removeTrack", id: "t0001" }], { ...human, design: designFor })).rejects.toThrow(
      /t0001 starts on the locked part R1/,
    )
    await expect(undoChange(root, { author: "human", design: designFor })).rejects.toThrow(/locked track t0001/)
    expect(asked).toEqual([FILE, FILE])
  })

  test("undo of copper elsewhere goes through while a part is locked", async () => {
    await applyLayoutEdits(root, FILE, [addTrack()], human)
    await lockR1()
    await applyLayoutEdits(root, FILE, [{ kind: "addVia", at: pad("R2#1"), drill: 0.3, diameter: 0.6 }], { ...human, design })
    await undoChange(root, { author: "human", design })
    expect(await layoutText()).not.toContain("v0001")
  })
})

describe("copper layers the board lacks", () => {
  const inner = (): LayoutEdit => ({ ...addTrack(), layer: "inner1" } as LayoutEdit)

  test("a track on an inner layer of a 2-layer board is refused and nothing is written", async () => {
    await expect(applyLayoutEdits(root, FILE, [inner()], { ...human, design })).rejects.toThrow("t0001 is on inner1 but the board has 2 layers")
    expect(existsSync(join(root, LAYOUT))).toBe(false)
  })

  test("a via listing an inner layer, or a track changed onto one, is refused", async () => {
    await applyLayoutEdits(root, FILE, [addTrack()], { ...human, design })
    const via: LayoutEdit = { kind: "addVia", at: pad("R2#1"), drill: 0.3, diameter: 0.6, layers: ["top", "inner1"] }
    await expect(applyLayoutEdits(root, FILE, [via], { author: "ai", design })).rejects.toThrow("v0001 joins inner1 but the board has 2 layers")
    await expect(applyLayoutEdits(root, FILE, [{ kind: "setTrack", id: "t0001", layer: "inner2" }], { ...human, design })).rejects.toThrow(
      "t0001 is on inner2 but the board has 2 layers",
    )
  })

  test("a 4-layer board takes inner copper", async () => {
    const four = CIRCUIT.replace('<board width="30mm" height="20mm">', '<board width="30mm" height="20mm" layers={4}>')
    await writeFile(join(root, FILE), four)
    const design4 = buildDesign({ [FILE]: four }, FILE)
    expect(design4.circuit.board?.layers).toBe(4)
    const result = await applyLayoutEdits(root, FILE, [inner()], { ...human, design: design4 })
    expect(result.records.map((r) => r.t === "track" && r.layer)).toEqual(["inner1"])
  })
})

describe("undo and redo of layout edits", () => {
  test("undo restores the exact text, redo brings the change back", async () => {
    await applyLayoutEdits(root, FILE, [addTrack()], human)
    const before = await layoutText()
    await applyLayoutEdits(root, FILE, [{ kind: "setTrack", id: "t0001", width: 0.5 }], human)
    const after = await layoutText()
    const undo = await undoChange(root, { author: "human" })
    expect(undo).toMatchObject({ file: LAYOUT, summary: "Undo: Change track t0001" })
    expect(await layoutText()).toBe(before)
    await redoChange(root, { author: "human" })
    expect(await layoutText()).toBe(after)
  })

  test("undoing the edit that made the file removes it; redo writes it again", async () => {
    const { entry } = await applyLayoutEdits(root, FILE, [addTrack()], human)
    await undoChange(root, { author: "human" })
    expect(existsSync(join(root, LAYOUT))).toBe(false)
    await redoChange(root, { author: "human" })
    expect(await layoutText()).toBe(entry.after)
  })

  test("undo is refused when the file changed since (the file-match rule)", async () => {
    await applyLayoutEdits(root, FILE, [addTrack()], human)
    await writeFile(join(root, LAYOUT), "")
    await expect(undoChange(root, { author: "human" })).rejects.toThrow(/has changed since/)
  })

  test("undo is refused when it would remove locked copper", async () => {
    await applyLayoutEdits(root, FILE, [addTrack()], human)
    await applyLayoutEdits(root, FILE, [{ kind: "addVia", at: pad("R2#1"), drill: 0.3, diameter: 0.6, locked: true }], human)
    await expect(undoChange(root, { author: "human" })).rejects.toThrow(/would change the locked via v0001/)
  })

  test("the agent's undo of its own change goes through while other copper is locked", async () => {
    await applyLayoutEdits(root, FILE, [addTrack()], human)
    await applyLayoutEdits(root, FILE, [{ kind: "setTrack", id: "t0001", locked: true }], human)
    await applyLayoutEdits(root, FILE, [{ kind: "addVia", at: pad("R2#1"), drill: 0.3, diameter: 0.6 }], { author: "ai" })
    await undoChange(root, { author: "ai" })
    expect(await layoutText()).not.toContain("v0001")
  })

  test("a person can undo their own lock", async () => {
    await applyLayoutEdits(root, FILE, [addTrack()], human)
    await applyLayoutEdits(root, FILE, [{ kind: "setTrack", id: "t0001", locked: true }], human)
    await undoChange(root, { author: "human" })
    expect(await layoutText()).toContain('"locked":false')
  })

  test("undoing the file's creation is refused while copper in it is locked", async () => {
    await applyLayoutEdits(root, FILE, [addTrack()], { author: "ai" })
    const text = (await layoutText()).replace('"locked":false', '"locked":true')
    await writeFile(join(root, LAYOUT), text)
    await mkdir(join(root, ".copperflow", "history"), { recursive: true })
    const entry = { id: "c0001", time: "t", author: "ai", file: LAYOUT, summary: "Add track t0001", before: "", after: text, absent: "before" }
    await writeFile(join(root, ".copperflow", "history", "c0001.json"), JSON.stringify(entry))
    await expect(undoChange(root, { author: "ai" })).rejects.toThrow(/would remove the locked track t0001/)
  })

  test("a crafted entry naming a layout file of a missing circuit is refused", async () => {
    await mkdir(join(root, ".copperflow", "history"), { recursive: true })
    const entry = { id: "c0001", time: "t", author: "ai", file: "other.circuit.layout.json", summary: "x", before: "a", after: "" }
    await writeFile(join(root, ".copperflow", "history", "c0001.json"), JSON.stringify(entry))
    await expect(undoChange(root, { author: "human" })).rejects.toThrow(/does not exist/)
  })

  test("the agent cannot undo a person's layout change", async () => {
    const { entry } = await applyLayoutEdits(root, FILE, [addTrack()], human)
    await expect(undoChange(root, { author: "ai" })).rejects.toThrow(/Nothing to undo/)
    await expect(undoChange(root, { author: "ai", id: entry.id })).rejects.toThrow(/only undo its own/)
  })

  test("circuit and layout changes share one history and undo newest first", async () => {
    await applyLayoutEdits(root, FILE, [addTrack()], human)
    const layoutAfterAdd = await layoutText()
    await editCircuit(root, FILE, [{ kind: "setProps", part: "R2", props: { pcbY: 1 } }], { author: "human", summary: "move R2" })
    await applyLayoutEdits(root, FILE, [{ kind: "setTrack", id: "t0001", width: 0.5 }], human)
    expect((await listEntries(root, 10)).map((e) => e.file)).toEqual([LAYOUT, FILE, LAYOUT])
    await undoChange(root, { author: "human" })
    expect(await layoutText()).toBe(layoutAfterAdd)
    await undoChange(root, { author: "human" })
    expect(await readFile(join(root, FILE), "utf8")).toBe(CIRCUIT)
    await undoChange(root, { author: "human" })
    expect(existsSync(join(root, LAYOUT))).toBe(false)
  })
})
