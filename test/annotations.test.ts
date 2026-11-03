import { describe, expect, test } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { analyzeCircuit } from "../src/core/analyze.js"
import {
  addMark,
  annotationsPathFor,
  emptyAnnotations,
  lockParts,
  readAnnotations,
  removeMark,
  unlockParts,
  verifyLocks,
  writeAnnotations,
} from "../src/core/annotations.js"
import { applyEdits } from "../src/core/edit.js"
import { BOARD } from "./fixtures.js"

const NOW = "2026-11-03T10:00:00.000Z"
const model = analyzeCircuit(BOARD)

describe("locks", () => {
  test("lockParts stores a snapshot of the part props without mutating the input", () => {
    const empty = emptyAnnotations()
    const ann = lockParts(empty, model, ["R1"], NOW)
    expect(empty.locks).toEqual([])
    expect(ann.locks).toEqual([
      {
        part: "R1",
        lockedAt: NOW,
        props: { resistance: '"5.1k"', footprint: '"0402"', pcbX: "{-4}", pcbY: "{2}" },
      },
    ])
  })

  test("locking twice keeps one entry and unknown parts are rejected", () => {
    const ann = lockParts(lockParts(emptyAnnotations(), model, ["R1"], NOW), model, ["R1"], NOW)
    expect(ann.locks).toHaveLength(1)
    expect(() => lockParts(emptyAnnotations(), model, ["NOPE"], NOW)).toThrow(/NOPE/)
  })

  test("unlockParts removes locks", () => {
    const ann = unlockParts(lockParts(emptyAnnotations(), model, ["R1", "C1"], NOW), ["R1"])
    expect(ann.locks.map((l) => l.part)).toEqual(["C1"])
  })

  test("verifyLocks reports changed and missing locked parts", () => {
    const ann = lockParts(emptyAnnotations(), model, ["R1", "C1"], NOW)
    expect(verifyLocks(ann, model)).toEqual([])
    const changed = applyEdits(BOARD, [{ kind: "setProps", part: "R1", props: { pcbX: 9 } }], new Set())
    const removed = applyEdits(changed, [{ kind: "removePart", part: "C1" }], new Set())
    expect(verifyLocks(ann, analyzeCircuit(removed))).toEqual([
      { part: "R1", kind: "changed", detail: "pcbX was {-4}, now {9}" },
      { part: "C1", kind: "missing", detail: "the locked part is no longer in the file" },
    ])
  })
})

describe("marks", () => {
  test("addMark assigns increasing ids and removeMark deletes by id", () => {
    const first = addMark(emptyAnnotations(), { text: "route GND here", view: "pcb", x: 10, y: 5 }, NOW)
    const second = addMark(first.annotations, { text: "keep ESD diode near J1" }, NOW)
    expect(first.mark).toEqual({ id: "m1", text: "route GND here", view: "pcb", x: 10, y: 5, createdAt: NOW })
    expect(second.mark.id).toBe("m2")
    expect(removeMark(second.annotations, "m1").marks.map((m) => m.id)).toEqual(["m2"])
    expect(() => removeMark(second.annotations, "m9")).toThrow(/m9/)
  })
})

describe("files", () => {
  test("the sidecar sits next to the circuit file", () => {
    expect(annotationsPathFor(join("a", "board.circuit.tsx"))).toBe(join("a", "board.circuit.annotations.json"))
  })

  test("reads an empty set when the file is missing and round-trips", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-ann-"))
    const path = join(dir, "x.annotations.json")
    expect(await readAnnotations(path)).toEqual(emptyAnnotations())
    const ann = lockParts(emptyAnnotations(), model, ["R1"], NOW)
    await writeAnnotations(path, ann)
    expect(await readAnnotations(path)).toEqual(ann)
  })

  test("rejects a malformed sidecar with a clear message", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-ann-"))
    const path = join(dir, "x.annotations.json")
    await writeFile(path, '{"version": 1, "locks": "nope"}')
    await expect(readAnnotations(path)).rejects.toThrow(/x\.annotations\.json/)
  })
})
