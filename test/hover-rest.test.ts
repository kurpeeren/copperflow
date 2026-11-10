import { describe, expect, test } from "vitest"
import type { Point } from "../studio/src/pcb/geometry.js"
import { createHoverDriver, withHoverLabel, type HoverEnv } from "../studio/src/pcb/hover-driver.js"
import type { HoverTarget } from "../studio/src/pcb/hover-label.js"
import { HOVER_IDLE, LABEL_OFFSET_PX, placeLabel, REST_MS, restDue, restStep, shownLabel, type RestEvent, type RestState } from "../studio/src/pcb/hover-rest.js"
import { HOVER_LABELS_KEY, loadHoverLabels, saveHoverLabels } from "../studio/src/shell/hover-label-setting.js"

const PAD: HoverTarget = { kind: "pad", id: "U1#5", text: "U1.5 VOUT · V3_3" }
const VIA: HoverTarget = { kind: "via", id: "v0003", text: "via v0003 · GND · top–bottom" }
const at = (x: number, y: number) => ({ x, y })
const run = (events: readonly RestEvent[], from: RestState = HOVER_IDLE): RestState => events.reduce(restStep, from)
const rest = (x: number, y: number, now: number, still = false): RestEvent => ({ kind: "move", at: at(x, y), now, still })
/** Rests at (10, 20) from t=0 until the pad's label shows. */
const shown = () => run([rest(10, 20, 0), { kind: "tick", now: REST_MS, target: PAD }])

describe("the hover label's rest", () => {
  test("the label shows when the pointer has rested 250 ms, of what is under it then, 12 px right-below it", () => {
    expect(REST_MS).toBe(250)
    expect(LABEL_OFFSET_PX).toBe(12)
    const waiting = run([rest(10, 20, 0)])
    expect(shownLabel(waiting)).toBeUndefined()
    expect(restDue(waiting, 100)).toBe(150)
    expect(restStep(waiting, { kind: "tick", now: 249, target: PAD })).toBe(waiting)
    expect(shownLabel(restStep(waiting, { kind: "tick", now: 250, target: PAD }))).toEqual({ text: PAD.text, left: 22, top: 32 })
    expect(restStep(waiting, { kind: "tick", now: 250, target: undefined })).toEqual(HOVER_IDLE)
  })

  test("a move restarts the rest; while shown it follows the pointer as long as it is still over the target", () => {
    const moved = run([rest(0, 0, 0), rest(3, 0, 200)])
    expect(restDue(moved, 250)).toBe(200)
    expect(shownLabel(restStep(shown(), rest(15, 25, 400, true)))).toEqual({ text: PAD.text, left: 27, top: 37 })
  })

  test("leaving the target hides the label and waits again, for whatever is under the pointer then", () => {
    const next = restStep(shown(), rest(50, 50, 500, false))
    expect(shownLabel(next)).toBeUndefined()
    expect(shownLabel(restStep(next, { kind: "tick", now: 750, target: VIA }))?.text).toBe(VIA.text)
  })

  test("leaving the canvas, the wheel, a camera or design change, or a drawing tool hides it", () => {
    for (const kind of ["leave", "stale", "busy"] as const) {
      expect(restStep(shown(), { kind })).toEqual(HOVER_IDLE)
      expect(restStep(run([rest(0, 0, 0)]), { kind })).toEqual(HOVER_IDLE)
    }
    expect(restDue(HOVER_IDLE, 0)).toBeUndefined()
  })

  test("a key or a press hides it, and it stays hidden while the pointer stays on that target", () => {
    for (const kind of ["key", "press"] as const) {
      const dismissed = restStep(shown(), { kind })
      expect(shownLabel(dismissed)).toBeUndefined()
      expect(restStep(dismissed, rest(11, 20, 600, true))).toBe(dismissed)
      const away = restStep(dismissed, rest(40, 20, 600, false))
      expect(shownLabel(restStep(away, { kind: "tick", now: 850, target: VIA }))?.text).toBe(VIA.text)
    }
  })

  test("a key or a press while resting stops the rest", () => {
    expect(run([rest(0, 0, 0), { kind: "press" }, { kind: "tick", now: 300, target: PAD }])).toEqual(HOVER_IDLE)
  })

  test("a tick for a state that is not resting changes nothing", () => {
    const state = shown()
    expect(restStep(state, { kind: "tick", now: 1000, target: VIA })).toBe(state)
    expect(restStep(HOVER_IDLE, { kind: "tick", now: 1000, target: VIA })).toBe(HOVER_IDLE)
  })
})

/** A clock the test turns, timers it fires, and a key listener it presses. */
function fakeEnv() {
  const clock = { now: 0 }
  const timers = new Map<number, { run: () => void; at: number }>()
  const keys = new Set<() => void>()
  let id = 0
  const env: HoverEnv = {
    now: () => clock.now,
    setTimer: (run, ms) => {
      timers.set(++id, { run, at: clock.now + ms })
      return id
    },
    clearTimer: (timer) => void timers.delete(timer as number),
    listenKeys: (run) => {
      keys.add(run)
      return () => void keys.delete(run)
    },
  }
  const advance = (ms: number) => {
    clock.now += ms
    for (const [key, timer] of [...timers]) {
      if (timer.at > clock.now) continue
      timers.delete(key)
      timer.run()
    }
  }
  const press = () => [...keys].forEach((run) => run())
  return { env, timers, keys, advance, press }
}

function driven(target: HoverTarget | undefined = PAD) {
  const fake = fakeEnv()
  const counts = { pick: 0, still: 0 }
  const states: RestState[] = []
  const probe = {
    pick: (_world: Point) => {
      counts.pick++
      return target
    },
    still: (_target: HoverTarget, world: Point) => {
      counts.still++
      return world.x < 5
    },
  }
  const driver = createHoverDriver(fake.env, (state) => states.push(state), () => probe)
  const last = () => states.at(-1) ?? HOVER_IDLE
  return { ...fake, driver, counts, last }
}

describe("the hover label's driver", () => {
  test("moves pick nothing; the pick runs once, when the rest is over, and a move while shown asks only whether it is still over", () => {
    const { driver, advance, counts, last } = driven()
    for (let x = 0; x < 4; x += 0.5) {
      driver.move(at(x, 0), at(x * 10, 0))
      advance(50)
    }
    expect(counts).toEqual({ pick: 0, still: 0 })
    advance(260)
    expect(counts.pick).toBe(1)
    expect(shownLabel(last())?.text).toBe(PAD.text)
    driver.move(at(4, 0), at(40, 0))
    expect(counts).toEqual({ pick: 1, still: 1 })
    expect(shownLabel(last())?.left).toBe(52)
    driver.move(at(6, 0), at(60, 0))
    expect(shownLabel(last())).toBeUndefined()
  })

  test("any key hides the label through the listener, and dispose stops the timer and the listener", () => {
    const { driver, advance, keys, timers, press, last, counts } = driven()
    driver.move(at(0, 0), at(0, 0))
    advance(300)
    expect(shownLabel(last())).toBeDefined()
    press()
    expect(shownLabel(last())).toBeUndefined()
    driver.move(at(9, 0), at(90, 0))
    expect(timers.size).toBe(1)
    driver.dispose()
    expect([timers.size, keys.size]).toEqual([0, 0])
    advance(1000)
    expect(counts.pick).toBe(1)
  })

  test("the wheel or a camera or design change hides it; while quiet, or over an overlay, moves are ignored", () => {
    const { driver, advance, last, timers } = driven()
    driver.move(at(0, 0), at(0, 0))
    advance(300)
    driver.stale()
    expect(last()).toEqual(HOVER_IDLE)
    driver.quiet(true)
    driver.move(at(0, 0), at(0, 0))
    expect(timers.size).toBe(0)
    driver.quiet(false)
    driver.move(at(0, 0), at(0, 0))
    advance(300)
    driver.over(false)
    expect(last()).toEqual(HOVER_IDLE)
    driver.move(at(1, 0), at(10, 0))
    expect(timers.size).toBe(0)
    driver.over(true)
    driver.move(at(1, 0), at(10, 0))
    expect(timers.size).toBe(1)
  })

  test("the canvas's handlers: a press and the wheel report to the label, and a move over an overlay is off the canvas", () => {
    const calls: string[] = []
    const canvas = { current: "canvas" }
    const handlers = withHoverLabel(
      { onPointerDown: (event: { target: string }) => void calls.push(`down ${event.target}`), onPointerMove: (event: { target: string }) => void calls.push(`move ${event.target}`) },
      { press: () => void calls.push("press"), stale: () => void calls.push("stale"), over: (on) => void calls.push(`over ${on}`) },
      canvas,
    )
    handlers.onPointerDown({ target: "canvas" })
    handlers.onPointerMove({ target: "canvas" })
    handlers.onPointerMove({ target: "status" })
    handlers.onWheel()
    expect(calls).toEqual(["press", "down canvas", "over true", "move canvas", "over false", "move status", "stale"])
  })
})

describe("the hover label's place", () => {
  const AREA = { width: 400, height: 300 }
  const LABEL = { width: 120, height: 20 }

  test("right-below the pointer while it fits the canvas", () => {
    expect(placeLabel({ left: 22, top: 32 }, LABEL, AREA)).toEqual({ left: 22, top: 32 })
  })

  test("left of the pointer near the right edge, above it near the bottom, never past the top left corner", () => {
    // The pointer at (380, 290): the label's corner would be (392, 302).
    expect(placeLabel({ left: 392, top: 302 }, LABEL, AREA)).toEqual({ left: 380 - 12 - 120, top: 290 - 12 - 20 })
    expect(placeLabel({ left: 392, top: 32 }, { width: 500, height: 20 }, AREA)).toEqual({ left: 0, top: 32 })
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
