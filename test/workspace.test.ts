import { beforeEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  editCircuit,
  listCircuits,
  loadCircuit,
  resolveInRoot,
  undoChange,
  updateAnnotations,
} from "../src/core/workspace.js"
import { listEntries } from "../src/core/history.js"
import { lockParts } from "../src/core/annotations.js"
import { BOARD } from "./fixtures.js"

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
