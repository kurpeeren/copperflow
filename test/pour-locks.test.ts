import { describe, expect, test } from "vitest"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { analyzeCircuit } from "../src/core/analyze.js"
import { emptyAnnotations, lockParts, unlockParts, verifyLocks } from "../src/core/annotations.js"
import { applyEdits, EditError } from "../src/core/edit.js"
import { formatSummary } from "../src/core/summary.js"
import { editCircuit, undoChange, updateAnnotations, loadCircuit } from "../src/core/workspace.js"

const NOW = "2026-11-11T10:00:00.000Z"
const FILE = "main.circuit.tsx"

const BOARD = `export default () => (
  <board width="30mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0402" />
    <copperpour net="GND" layer="bottom" />
    <hole x={2} y={3} diameter={3.2} />
    <trace from=".R1 > .pin1" to="net.GND" />
  </board>
)
`
const model = analyzeCircuit(BOARD)

describe("locks on pours and holes", () => {
  test("a pour and a hole are locked by id, with a snapshot of their props, flagged as not parts", () => {
    const locks = lockParts(emptyAnnotations(), model, ["copperpour:1", "hole:1"], NOW).locks
    expect(locks).toEqual([
      { part: "copperpour:1", drawing: true, props: { net: '"GND"', layer: '"bottom"' }, lockedAt: NOW },
      { part: "hole:1", drawing: true, props: { x: "{2}", y: "{3}", diameter: "{3.2}" }, lockedAt: NOW },
    ])
    expect(unlockParts({ version: 1, locks, marks: [] }, ["copperpour:1"]).locks.map((lock) => lock.part)).toEqual(["hole:1"])
  })

  test("an unknown pour id is refused", () => {
    expect(() => lockParts(emptyAnnotations(), model, ["copperpour:2"], NOW)).toThrow(/copperpour:2/)
  })

  test("a part lock never covers a pour: locking R1 leaves the pour editable", () => {
    const locked = new Set(lockParts(emptyAnnotations(), model, ["R1"], NOW).locks.map((lock) => lock.part))
    const next = applyEdits(BOARD, [{ kind: "setPour", id: "copperpour:1", props: { priority: 2 } }], locked)
    expect(next).toContain("priority={2}")
  })

  test("a locked pour or hole refuses an edit by id", () => {
    const locked = new Set(lockParts(emptyAnnotations(), model, ["copperpour:1", "hole:1"], NOW).locks.map((lock) => lock.part))
    expect(() => applyEdits(BOARD, [{ kind: "removePour", id: "copperpour:1" }], locked)).toThrow(EditError)
    expect(() => applyEdits(BOARD, [{ kind: "setHole", id: "hole:1", props: { diameter: 2 } }], locked)).toThrow(/locked/)
  })

  test("verifyLocks names a changed or missing locked pour or hole", () => {
    const annotations = lockParts(emptyAnnotations(), model, ["copperpour:1", "hole:1"], NOW)
    const changed = analyzeCircuit(BOARD.replace('layer="bottom"', 'layer="top"').replace(/\s*<hole[^>]*>/, ""))
    expect(verifyLocks(annotations, changed)).toEqual([
      { part: "copperpour:1", kind: "changed", detail: 'layer was "bottom", now "top"' },
      { part: "hole:1", kind: "missing", detail: "the locked hole is no longer in the file" },
    ])
  })

  test("the full summary lists pours and holes by id, a locked one marked", async () => {
    const annotations = lockParts(emptyAnnotations(), model, ["hole:1"], NOW)
    const text = formatSummary({ file: FILE, path: FILE, source: BOARD, model, annotations, violations: [] } as never)
    expect(text).toContain('Pours and holes:\n  copperpour:1 <copperpour> net="GND" layer="bottom"\n  hole:1 <hole> [LOCKED] x={2} y={3} diameter={3.2}')
  })

  test("undo refuses to take back a change that would alter a pour locked since", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-pour-locks-"))
    await writeFile(join(root, FILE), BOARD)
    await editCircuit(root, FILE, [{ kind: "setPour", id: "copperpour:1", props: { priority: 3 } }], { author: "ai", summary: "raise the pour" })
    const { model: now } = await loadCircuit(root, FILE)
    await updateAnnotations(root, FILE, (a) => lockParts(a, now, ["copperpour:1"], NOW))
    await expect(undoChange(root, { author: "ai" })).rejects.toThrow(/copper pour copperpour:1/)
    expect(await readFile(join(root, FILE), "utf8")).toContain("priority={3}")
  })
})
