import { describe, expect, test } from "vitest"
import type { BuildState } from "../studio/src/api.js"
import { BUILDING_TEXT, bottomNotice, canvasNotice, hasNoCircuit, NO_CIRCUIT_TEXT } from "../studio/src/shell/canvas-notice.js"
import { statusText } from "../studio/src/shell/status-pill.js"

const idle: BuildState = { status: "idle" }
const building: BuildState = { status: "building" }
const failed: BuildState = { status: "failed", error: "main.circuit.tsx: Unexpected token" }

describe("canvasNotice", () => {
  test("a project with no circuit file shows the start screen", () => {
    expect(canvasNotice({ files: [], build: idle })).toEqual({ kind: "start" })
  })

  test("before the files are listed the canvas says it is building, not the start screen", () => {
    expect(canvasNotice({ files: undefined, build: idle })).toEqual({ kind: "text", text: BUILDING_TEXT })
  })

  test("a circuit being built says so", () => {
    expect(canvasNotice({ files: ["main.circuit.tsx"], build: building })).toEqual({ kind: "text", text: BUILDING_TEXT })
  })

  test("a failed build shows its error", () => {
    expect(canvasNotice({ files: ["main.circuit.tsx"], build: failed })).toEqual({ kind: "text", text: failed.error })
  })

  test("a built design needs no notice", () => {
    const done = { status: "done", design: {} } as unknown as BuildState
    expect(canvasNotice({ files: ["main.circuit.tsx"], build: done })).toEqual({ kind: "none" })
  })

  test("the bottom panel says the folder has no circuit", () => {
    expect(bottomNotice({ files: [], build: idle })).toBe(NO_CIRCUIT_TEXT)
    expect(bottomNotice({ files: ["a.circuit.tsx"], build: failed })).toBe(failed.error)
  })

  test("a failed file listing shows its error, not Building for good", () => {
    expect(canvasNotice({ files: undefined, build: idle, listError: "Out of date key" })).toEqual({ kind: "text", text: "Out of date key" })
  })

  test("hasNoCircuit only once the list is known", () => {
    expect(hasNoCircuit(undefined)).toBe(false)
    expect(hasNoCircuit([])).toBe(true)
  })

  test("the status pill says there is no circuit instead of Not built", () => {
    expect(statusText(idle, 0, true)).toBe("No circuit")
    expect(statusText(idle, 0)).toBe("Not built")
  })
})
