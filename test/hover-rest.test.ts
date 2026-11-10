import { describe, expect, test } from "vitest"
import { HOVER_IDLE, LABEL_OFFSET_PX, REST_MS, restDue, restStep, shownLabel, type RestEvent, type RestState } from "../studio/src/pcb/hover-rest.js"
import { HOVER_LABELS_KEY, loadHoverLabels, saveHoverLabels } from "../studio/src/shell/hover-label-setting.js"

const PAD = { kind: "pad" as const, id: "U1#5", text: "U1.5 VOUT · V3_3" }
const VIA = { kind: "via" as const, id: "v0003", text: "via v0003 · GND · top–bottom" }
const at = (x: number, y: number) => ({ x, y })
const run = (events: readonly RestEvent[], from: RestState = HOVER_IDLE): RestState => events.reduce(restStep, from)
/** Rests on the pad from t=0 until the label shows. */
const shown = () => run([{ kind: "move", target: PAD, at: at(10, 20), now: 0 }, { kind: "tick", now: REST_MS }])

describe("the hover label's rest", () => {
  test("the label shows after the pointer rests 250 ms on a target, 12 px right-below it", () => {
    expect(REST_MS).toBe(250)
    expect(LABEL_OFFSET_PX).toBe(12)
    const waiting = run([{ kind: "move", target: PAD, at: at(10, 20), now: 0 }])
    expect(shownLabel(waiting)).toBeUndefined()
    expect(restDue(waiting, 100)).toBe(150)
    expect(shownLabel(restStep(waiting, { kind: "tick", now: 249 }))).toBeUndefined()
    expect(shownLabel(restStep(waiting, { kind: "tick", now: 250 }))).toEqual({ text: PAD.text, left: 22, top: 32 })
  })

  test("it follows the pointer while the target stays the same, and moving on the same target does not restart the wait", () => {
    const moved = restStep(shown(), { kind: "move", target: PAD, at: at(15, 25), now: 400 })
    expect(shownLabel(moved)).toEqual({ text: PAD.text, left: 27, top: 37 })
    const waiting = run([{ kind: "move", target: PAD, at: at(0, 0), now: 0 }, { kind: "move", target: PAD, at: at(3, 0), now: 200 }, { kind: "tick", now: 250 }])
    expect(shownLabel(waiting)?.text).toBe(PAD.text)
  })

  test("a new target hides the label and waits again", () => {
    const next = restStep(shown(), { kind: "move", target: VIA, at: at(50, 50), now: 500 })
    expect(shownLabel(next)).toBeUndefined()
    expect(shownLabel(restStep(next, { kind: "tick", now: 750 }))?.text).toBe(VIA.text)
  })

  test("leaving the target or the canvas hides it", () => {
    expect(restStep(shown(), { kind: "move", target: undefined, at: at(0, 0), now: 300 })).toEqual(HOVER_IDLE)
    expect(restStep(shown(), { kind: "leave" })).toEqual(HOVER_IDLE)
  })

  test("a key or a press hides it, and it stays hidden on that target until the pointer moves to another", () => {
    for (const kind of ["key", "press"] as const) {
      const dismissed = restStep(shown(), { kind })
      expect(shownLabel(dismissed)).toBeUndefined()
      const still = run([{ kind: "move", target: PAD, at: at(11, 20), now: 600 }, { kind: "tick", now: 900 }], dismissed)
      expect(shownLabel(still)).toBeUndefined()
      const other = run([{ kind: "move", target: VIA, at: at(11, 20), now: 600 }, { kind: "tick", now: 900 }], dismissed)
      expect(shownLabel(other)?.text).toBe(VIA.text)
    }
  })

  test("a key or a press while waiting stops the wait", () => {
    const waiting = run([{ kind: "move", target: PAD, at: at(0, 0), now: 0 }, { kind: "press" }, { kind: "tick", now: 300 }])
    expect(shownLabel(waiting)).toBeUndefined()
  })

  test("while a tool is drawing, or the labels are off, nothing shows", () => {
    expect(restStep(shown(), { kind: "busy" })).toEqual(HOVER_IDLE)
    expect(restDue(HOVER_IDLE, 0)).toBeUndefined()
  })

  test("a target whose text changed (a build renamed its net) keeps showing with the new text", () => {
    const renamed = restStep(shown(), { kind: "move", target: { ...PAD, text: "U1.5 VOUT · V3V3" }, at: at(10, 20), now: 400 })
    expect(shownLabel(renamed)?.text).toBe("U1.5 VOUT · V3V3")
  })

  test("a tick for a state that is not waiting changes nothing", () => {
    const state = shown()
    expect(restStep(state, { kind: "tick", now: 1000 })).toBe(state)
    expect(restStep(HOVER_IDLE, { kind: "tick", now: 1000 })).toBe(HOVER_IDLE)
  })
})

describe("View → Hover labels, remembered per browser", () => {
  const memory = (value: string | null = null) => {
    const kept = new Map<string, string>(value === null ? [] : [[HOVER_LABELS_KEY, value]])
    return { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, v: string) => void kept.set(key, v), kept }
  }

  test("on until switched off, under copperflow.hoverLabels", () => {
    expect(HOVER_LABELS_KEY).toBe("copperflow.hoverLabels")
    expect(loadHoverLabels(() => memory())).toBe(true)
    expect(loadHoverLabels(() => undefined)).toBe(true)
    expect(loadHoverLabels(() => memory("off"))).toBe(false)
    expect(loadHoverLabels(() => memory("on"))).toBe(true)
  })

  test("the choice is saved and read back", () => {
    const store = memory()
    expect(saveHoverLabels(() => store, false)).toBe(true)
    expect(store.kept.get(HOVER_LABELS_KEY)).toBe("off")
    expect(loadHoverLabels(() => store)).toBe(false)
    expect(saveHoverLabels(() => store, true)).toBe(true)
    expect(loadHoverLabels(() => store)).toBe(true)
  })

  test("blocked storage reads as on and a save says it did not keep the choice", () => {
    const blocked = () => {
      throw new Error("blocked")
    }
    expect(loadHoverLabels(blocked)).toBe(true)
    expect(saveHoverLabels(blocked, false)).toBe(false)
    expect(saveHoverLabels(() => undefined, false)).toBe(false)
  })
})
