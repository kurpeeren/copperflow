import { describe, expect, test } from "vitest"
import { SLOT_STOPPED_EVENTS, slotEventStops } from "../studio/src/shell/slot-events.js"

describe("toolbar slot events", () => {
  test("pointer, mouse, wheel and context-menu events stop at the slot", () => {
    for (const name of ["onPointerDown", "onPointerMove", "onPointerUp", "onMouseDown", "onMouseMove", "onWheel", "onContextMenu"]) {
      expect([name, (SLOT_STOPPED_EVENTS as readonly string[]).includes(name)]).toEqual([name, true])
    }
  })

  test("clicks, changes and keys go on, so the slot's own controls and the key gate still work", () => {
    for (const name of ["onClick", "onChange", "onKeyDown", "onFocus", "onBlur"]) {
      expect([name, (SLOT_STOPPED_EVENTS as readonly string[]).includes(name)]).toEqual([name, false])
    }
  })

  test("each handler stops the event from leaving the slot, and does nothing else to it", () => {
    const stops = slotEventStops()
    expect(Object.keys(stops).sort()).toEqual([...SLOT_STOPPED_EVENTS].sort())
    for (const name of SLOT_STOPPED_EVENTS) {
      let stopped = 0
      stops[name]({ stopPropagation: () => void stopped++ })
      expect([name, stopped]).toEqual([name, 1])
    }
  })
})
