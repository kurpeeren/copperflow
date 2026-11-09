import { beforeEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  editCircuit,
  listCircuits,
  loadCircuit,
  redoChange,
  resolveInRoot,
  undoChange,
  updateAnnotations,
} from "../src/core/workspace.js"
import { listEntries } from "../src/core/history.js"
import { lockParts } from "../src/core/annotations.js"
import { BOARD, DRAWINGS } from "./fixtures.js"

let root: string
const FILE = "boards/main.circuit.tsx"

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-ws-"))
  await mkdir(join(root, "boards"))
  await mkdir(join(root, "node_modules", "dep"), { recursive: true })
  await writeFile(join(root, FILE), BOARD)
  await writeFile(join(root, "node_modules", "dep", "x.circuit.tsx"), BOARD)
})

const read = () => readFile(join(root, FILE), "utf8")

describe("paths", () => {
  test("rejects paths outside the project root", () => {
    expect(() => resolveInRoot(root, "../secret.tsx")).toThrow(/outside the project/)
    expect(resolveInRoot(root, FILE)).toBe(join(root, "boards", "main.circuit.tsx"))
  })

  test("lists circuit files and skips node_modules", async () => {
    expect(await listCircuits(root)).toEqual([FILE])
  })
})

describe("editing and history", () => {
  test("editCircuit writes the file and records who changed what", async () => {
    const result = await editCircuit(root, FILE, [{ kind: "setProps", part: "R1", props: { pcbX: 1 } }], {
      author: "ai",
      summary: "move R1",
    })
    expect(await read()).toContain("pcbX={1}")
    expect(result.entry).toMatchObject({ author: "ai", file: FILE, summary: "move R1" })
    expect((await listEntries(root, 10)).map((e) => e.summary)).toEqual(["move R1"])
  })

  test("locks in the sidecar are enforced", async () => {
    const { model } = await loadCircuit(root, FILE)
    await updateAnnotations(root, FILE, (ann) => lockParts(ann, model, ["R1"], "2026-11-03T10:00:00.000Z"))
    await expect(
      editCircuit(root, FILE, [{ kind: "setProps", part: "R1", props: { pcbX: 1 } }], { author: "ai", summary: "x" }),
    ).rejects.toThrow(/locked/)
  })

  test("an edit that changes nothing is rejected", async () => {
    await expect(
      editCircuit(root, FILE, [{ kind: "setProps", part: "R1", props: { pcbX: -4 } }], { author: "ai", summary: "x" }),
    ).rejects.toThrow(/no change/)
  })

  test("undo restores the previous content and is logged", async () => {
    await editCircuit(root, FILE, [{ kind: "removePart", part: "LED1" }], { author: "ai", summary: "remove LED1" })
    const undo = await undoChange(root, { author: "human" })
    expect(await read()).toBe(BOARD)
    expect(undo.summary).toBe("Undo: remove LED1")
    const entries = await listEntries(root, 10)
    expect(entries.map((e) => [e.summary, e.undone])).toEqual([
      ["Undo: remove LED1", false],
      ["remove LED1", true],
    ])
    await expect(undoChange(root, { author: "human" })).rejects.toThrow(/Nothing to undo/)
  })

  test("undo refuses when the file changed afterwards", async () => {
    await editCircuit(root, FILE, [{ kind: "removePart", part: "LED1" }], { author: "ai", summary: "remove LED1" })
    await writeFile(join(root, FILE), (await read()) + "\n// edited by hand\n")
    await expect(undoChange(root, { author: "human" })).rejects.toThrow(/changed since/)
  })

  test("the agent can only undo its own changes", async () => {
    const human = await editCircuit(root, FILE, [{ kind: "removePart", part: "LED1" }], {
      author: "human",
      summary: "human removes LED1",
    })
    await expect(undoChange(root, { author: "ai" })).rejects.toThrow(/Nothing to undo/)
    await expect(undoChange(root, { author: "ai", id: human.entry.id })).rejects.toThrow(/only undo its own/)
  })

  test("a differently spelled path cannot skip the locks", async () => {
    const { model } = await loadCircuit(root, FILE)
    await updateAnnotations(root, FILE, (ann) => lockParts(ann, model, ["R1"], "2026-11-03T10:00:00.000Z"))
    for (const spelling of ["boards/MAIN.CIRCUIT.TSX", "boards/main.circuit.TSX", "boards/main.circuit.tsx::$DATA"]) {
      await expect(
        editCircuit(root, spelling, [{ kind: "setProps", part: "R1", props: { pcbX: 1 } }], { author: "ai", summary: "x" }),
      ).rejects.toThrow()
    }
    expect(await read()).toBe(BOARD)
  })

  test("only *.circuit.tsx files can be edited", async () => {
    await writeFile(join(root, "boards", "other.tsx"), BOARD)
    await expect(
      editCircuit(root, "boards/other.tsx", [{ kind: "setProps", part: "R1", props: { pcbX: 1 } }], { author: "ai", summary: "x" }),
    ).rejects.toThrow(/\.circuit\.tsx/)
  })

  test("names that merely start with two dots are inside the project", () => {
    expect(resolveInRoot(root, "..x.circuit.tsx")).toBe(join(root, "..x.circuit.tsx"))
  })

  test("parallel edits are applied one after another and stay undoable", async () => {
    await Promise.all([
      editCircuit(root, FILE, [{ kind: "setProps", part: "R1", props: { pcbX: 1 } }], { author: "ai", summary: "move R1" }),
      editCircuit(root, FILE, [{ kind: "setProps", part: "C1", props: { pcbX: 2 } }], { author: "ai", summary: "move C1" }),
    ])
    const text = await read()
    expect(text).toContain("pcbX={1}")
    expect(text).toContain("      pcbX={2}")
    await undoChange(root, { author: "ai" })
    await undoChange(root, { author: "ai" })
    expect(await read()).toBe(BOARD)
  })

  test("undo refuses to change a part the human locked afterwards", async () => {
    await editCircuit(root, FILE, [{ kind: "setProps", part: "R1", props: { resistance: "9k" } }], { author: "ai", summary: "R1 9k" })
    const { model } = await loadCircuit(root, FILE)
    await updateAnnotations(root, FILE, (ann) => lockParts(ann, model, ["R1"], "2026-11-03T10:00:00.000Z"))
    await expect(undoChange(root, { author: "ai" })).rejects.toThrow(/locked/)
    expect(await read()).toContain('resistance="9k"')
  })

  test("a crafted history entry cannot write outside circuit files", async () => {
    await mkdir(join(root, ".copperflow", "history"), { recursive: true })
    await writeFile(join(root, "package.json"), "{}")
    const entry = { id: "c0001", time: "t", author: "ai", file: "package.json", summary: "x", before: "pwned", after: "{}" }
    await writeFile(join(root, ".copperflow", "history", "c0001.json"), JSON.stringify(entry))
    await expect(undoChange(root, { author: "human" })).rejects.toThrow(/\.circuit\.tsx/)
    expect(await readFile(join(root, "package.json"), "utf8")).toBe("{}")
  })

  test("a crafted loop of undos and redos does not hang the history list", async () => {
    await mkdir(join(root, ".copperflow", "history"), { recursive: true })
    const base = { time: "t", author: "human", file: FILE, before: BOARD, after: BOARD }
    const entries = [
      { ...base, id: "c0001", summary: "a", redoOf: "c0002" },
      { ...base, id: "c0002", summary: "b", undoOf: "c0001" },
    ]
    for (const entry of entries) await writeFile(join(root, ".copperflow", "history", `${entry.id}.json`), JSON.stringify(entry))
    expect((await listEntries(root, 10)).map((e) => [e.id, e.undone, e.redoneAs ?? null])).toEqual([
      ["c0002", false, "c0001"],
      ["c0001", true, null],
    ])
  })

  test("a damaged history file is named in the error and does not block new edits", async () => {
    await mkdir(join(root, ".copperflow", "history"), { recursive: true })
    await writeFile(join(root, ".copperflow", "history", "c0001.json"), '{"id": "c00')
    const result = await editCircuit(root, FILE, [{ kind: "setProps", part: "R1", props: { pcbX: 1 } }], { author: "ai", summary: "x" })
    expect(result.entry.id).toBe("c0002")
    await expect(undoChange(root, { author: "ai" })).rejects.toThrow(/c0001\.json/)
  })

  test("loadCircuit reports lock violations made outside copperflow", async () => {
    const { model } = await loadCircuit(root, FILE)
    await updateAnnotations(root, FILE, (ann) => lockParts(ann, model, ["R1"], "2026-11-03T10:00:00.000Z"))
    await writeFile(join(root, FILE), BOARD.replace("pcbX={-4}", "pcbX={0}"))
    const loaded = await loadCircuit(root, FILE)
    expect(loaded.violations).toEqual([{ part: "R1", kind: "changed", detail: "pcbX was {-4}, now {0}" }])
  })
})

describe("redo", () => {
  const OTHER = "boards/other.circuit.tsx"
  const removeLed = (author: "ai" | "human" = "ai") =>
    editCircuit(root, FILE, [{ kind: "removePart", part: "LED1" }], { author, summary: "remove LED1" })
  const move = (file: string, part: string, pcbX: number) =>
    editCircuit(root, file, [{ kind: "setProps", part, props: { pcbX } }], { author: "human", summary: `move ${part}` })

  test("redo re-applies the newest undone change and is logged", async () => {
    await removeLed()
    const edited = await read()
    const undo = await undoChange(root, { author: "human" })
    const redo = await redoChange(root, { author: "human" })
    expect(await read()).toBe(edited)
    expect(redo).toMatchObject({ author: "human", file: FILE, summary: "Redo: remove LED1", redoOf: undo.id, before: BOARD, after: edited })
    const entries = await listEntries(root, 10)
    expect(entries.map((e) => [e.summary, e.undone, e.redoneAs])).toEqual([
      ["Redo: remove LED1", false, undefined],
      ["Undo: remove LED1", false, redo.id],
      ["remove LED1", false, redo.id],
    ])
    await expect(redoChange(root, { author: "human" })).rejects.toThrow(/Nothing to redo/)
  })

  test("an undo of a redo works like any undo, and that undo can be redone too", async () => {
    await removeLed()
    const edited = await read()
    await undoChange(root, { author: "human" })
    await redoChange(root, { author: "human" })
    const again = await undoChange(root, { author: "human" })
    expect(await read()).toBe(BOARD)
    expect(again.summary).toBe("Undo: remove LED1")
    const redo = await redoChange(root, { author: "human" })
    expect(await read()).toBe(edited)
    expect(redo).toMatchObject({ summary: "Redo: remove LED1", redoOf: again.id })
  })

  test("the history shows a redone change as redone, as the redo it lives on as, and as undone once that is undone", async () => {
    const edit = await removeLed()
    const undo = await undoChange(root, { author: "human" })
    const redo = await redoChange(root, { author: "human" })
    const marks = async () => (await listEntries(root, 10)).map((e) => [e.id, e.undone, e.redoneAs])
    const undoAgain = await undoChange(root, { author: "human" })
    expect(await marks()).toEqual([
      [undoAgain.id, false, undefined],
      [redo.id, true, undefined],
      [undo.id, false, redo.id],
      [edit.entry.id, true, undefined],
    ])
    const redoAgain = await redoChange(root, { author: "human" })
    expect(await marks()).toEqual([
      [redoAgain.id, false, undefined],
      [undoAgain.id, false, redoAgain.id],
      [redo.id, false, redoAgain.id],
      [undo.id, false, redo.id],
      [edit.entry.id, false, redoAgain.id],
    ])
  })

  test("undoing a change that was redone names the redo to undo instead", async () => {
    const edit = await removeLed()
    await undoChange(root, { author: "human" })
    const redo = await redoChange(root, { author: "human" })
    await expect(undoChange(root, { author: "human", id: edit.entry.id })).rejects.toThrow(
      `${edit.entry.id} was undone and redone as ${redo.id}; undo ${redo.id} instead`,
    )
    await undoChange(root, { author: "human", id: redo.id })
    await expect(undoChange(root, { author: "human", id: edit.entry.id })).rejects.toThrow(/already undone/)
  })

  test("redo walks back up the undo stack in order", async () => {
    await move(FILE, "R1", 1)
    const first = await read()
    await move(FILE, "C1", 2)
    const second = await read()
    await undoChange(root, { author: "human" })
    await undoChange(root, { author: "human" })
    expect(await read()).toBe(BOARD)
    expect((await redoChange(root, { author: "human" })).summary).toBe("Redo: move R1")
    expect(await read()).toBe(first)
    expect((await redoChange(root, { author: "human" })).summary).toBe("Redo: move C1")
    expect(await read()).toBe(second)
  })

  test("a named change is redone, by its own id or by the id of the undo that undid it", async () => {
    await writeFile(join(root, OTHER), BOARD)
    await move(FILE, "R1", 1)
    const other = await move(OTHER, "R1", 3)
    await undoChange(root, { author: "human" })
    const undoFirst = await undoChange(root, { author: "human" })
    const redoOther = await redoChange(root, { author: "human", id: other.entry.id })
    expect(redoOther).toMatchObject({ file: OTHER, summary: "Redo: move R1" })
    expect(await readFile(join(root, OTHER), "utf8")).toContain("pcbX={3}")
    expect(await read()).toBe(BOARD)
    expect((await redoChange(root, { author: "human", id: undoFirst.id })).redoOf).toBe(undoFirst.id)
    expect(await read()).toContain("pcbX={1}")
  })

  test("redo refuses when the file changed after the undo", async () => {
    await removeLed()
    await undoChange(root, { author: "human" })
    await writeFile(join(root, FILE), BOARD + "\n// edited by hand\n")
    await expect(redoChange(root, { author: "human" })).rejects.toThrow(/changed since/)
    expect(await read()).toBe(BOARD + "\n// edited by hand\n")
  })

  test("redo refuses to change a part the human locked after the undo", async () => {
    await editCircuit(root, FILE, [{ kind: "setProps", part: "R1", props: { resistance: "9k" } }], { author: "ai", summary: "R1 9k" })
    await undoChange(root, { author: "human" })
    const { model } = await loadCircuit(root, FILE)
    await updateAnnotations(root, FILE, (ann) => lockParts(ann, model, ["R1"], "2026-11-03T10:00:00.000Z"))
    await expect(redoChange(root, { author: "human" })).rejects.toThrow(/locked part R1/)
    expect(await read()).toBe(BOARD)
    expect((await listEntries(root, 10)).map((e) => e.summary)).toEqual(["Undo: R1 9k", "R1 9k"])
  })

  test("there is nothing to redo before any undo", async () => {
    await expect(redoChange(root, { author: "human" })).rejects.toThrow(/Nothing to redo/)
    const edit = await removeLed()
    await expect(redoChange(root, { author: "human" })).rejects.toThrow(/Nothing to redo/)
    await expect(redoChange(root, { author: "human", id: edit.entry.id })).rejects.toThrow(/is not undone/)
    await expect(redoChange(root, { author: "human", id: "c0099" })).rejects.toThrow(/No change with id c0099/)
  })

  test("a new change to the file clears the redo chain", async () => {
    const edit = await removeLed()
    await undoChange(root, { author: "human" })
    await move(FILE, "R1", 1)
    const moved = await read()
    await expect(redoChange(root, { author: "human" })).rejects.toThrow(/Nothing to redo/)
    await expect(redoChange(root, { author: "human", id: edit.entry.id })).rejects.toThrow(/newer change/)
    expect(await read()).toBe(moved)
  })

  test("a change to another file leaves the redo chain alone", async () => {
    await writeFile(join(root, OTHER), BOARD)
    await removeLed()
    const edited = await read()
    await undoChange(root, { author: "human" })
    await move(OTHER, "R1", 1)
    await redoChange(root, { author: "human" })
    expect(await read()).toBe(edited)
  })

  test("an undo that is redone cannot be redone twice", async () => {
    await removeLed()
    const undo = await undoChange(root, { author: "human" })
    await redoChange(root, { author: "human" })
    await expect(redoChange(root, { author: "human", id: undo.id })).rejects.toThrow(/already redone/)
  })

  test("the agent can only redo its own undos; the human may redo any", async () => {
    await removeLed()
    const human = await undoChange(root, { author: "human" })
    await expect(redoChange(root, { author: "ai" })).rejects.toThrow(/Nothing to redo/)
    await expect(redoChange(root, { author: "ai", id: human.id })).rejects.toThrow(/only redo its own/)
    expect(await read()).toBe(BOARD)
    await editCircuit(root, FILE, [{ kind: "setProps", part: "C1", props: { pcbX: 2 } }], { author: "ai", summary: "move C1" })
    const own = await undoChange(root, { author: "ai" })
    expect((await redoChange(root, { author: "ai" })).redoOf).toBe(own.id)
    const agents = await undoChange(root, { author: "ai" })
    expect((await redoChange(root, { author: "human" })).redoOf).toBe(agents.id)
  })
})

describe("drawing edits in the history", () => {
  const meta = (summary: string) => ({ author: "human" as const, summary })

  beforeEach(async () => {
    await writeFile(join(root, FILE), DRAWINGS)
  })

  test("each call is one history entry, and undo restores the exact text", async () => {
    const points = [
      { x: 0, y: 4 },
      { x: 2, y: 4 },
    ]
    await editCircuit(root, FILE, [{ kind: "addDrawing", tag: "schematicpath", name: "G3", props: { points } }], meta("draw G3"))
    await editCircuit(
      root,
      FILE,
      [
        { kind: "setDrawingProps", id: "G1", props: { x: 2, y: 3 } },
        { kind: "setDrawingProps", id: "G3", props: { points: points.map((p) => ({ x: p.x + 1, y: p.y })) } },
      ],
      meta("move G1, G3"),
    )
    await editCircuit(root, FILE, [{ kind: "removeDrawing", id: "drawing:path:1" }], meta("delete a line"))
    expect((await listEntries(root, 10)).map((e) => e.summary)).toEqual(["delete a line", "move G1, G3", "draw G3"])
    const text = await read()
    expect(text).toContain('<schematicpath name="G3" points={[{ x: 1, y: 4 }, { x: 3, y: 4 }]} />')
    expect(text).toContain("x={2} y={3} width")
    for (let i = 0; i < 3; i++) await undoChange(root, { author: "human" })
    expect(await read()).toBe(DRAWINGS)
  })

  test("locks on drawings are enforced, and undo will not change a locked drawing", async () => {
    await editCircuit(root, FILE, [{ kind: "setDrawingProps", id: "G1", props: { x: 5 } }], { author: "ai", summary: "move G1" })
    const { model } = await loadCircuit(root, FILE)
    await updateAnnotations(root, FILE, (ann) => lockParts(ann, model, ["G1"], "2026-11-09T10:00:00.000Z"))
    await expect(editCircuit(root, FILE, [{ kind: "removeDrawing", id: "G1" }], meta("x"))).rejects.toThrow(/G1 is locked/)
    await expect(undoChange(root, { author: "ai" })).rejects.toThrow(/locked part G1/)
    expect(await read()).toContain("x={5} y={2}")
  })
})
