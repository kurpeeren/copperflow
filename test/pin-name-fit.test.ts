import { describe, expect, test } from "vitest"
import { fitName, fitPinNames, fitText, MIN_NAME_SCALE, type PinName } from "../studio/src/pcb/pin-name-fit.js"

/** Every character is 6 px wide at the pin-name size. */
const measure = (text: string) => text.length * 6
const full = (text: string) => ({ text, scale: 1 })
const smaller = (text: string, scale: number) => ({ text, scale: expect.closeTo(scale, 9) })

describe("fitText", () => {
  test("a text that fits is kept", () => {
    expect(fitText("VBUS", 24, measure)).toBe("VBUS")
  })

  test("a text that does not fit is shortened with an ellipsis to what fits", () => {
    expect(fitText("VBUS1", 24, measure)).toBe("VBU…")
    expect(fitText("VBUS1", 18, measure)).toBe("VB…")
  })

  test("it is dropped when fewer than two characters would fit", () => {
    expect(fitText("VBUS1", 17, measure)).toBeNull()
    expect(fitText("VBUS1", 0, measure)).toBeNull()
  })
})

describe("fitName", () => {
  test("a name that fits is drawn at full size", () => {
    expect(fitName("VBUS", 24, measure)).toEqual(full("VBUS"))
  })

  test("a wider name is drawn smaller first, down to 70% of the pin-name size", () => {
    expect(MIN_NAME_SCALE).toBe(0.7)
    expect(fitName("VBUS1", 24, measure)).toEqual(smaller("VBUS1", 0.8))
    expect(fitName("VBUS1", 21, measure)).toEqual(smaller("VBUS1", 0.7))
  })

  test("still too wide at 70%, it is shortened with an ellipsis at that size, and dropped only under two characters", () => {
    expect(fitName("VBUS1", 20, measure)).toEqual(smaller("VBU…", 0.7))
    expect(fitName("VBUS1", 8, measure)).toBeNull()
  })
})

/** The body centre on screen. */
const O = { x: 100, y: 100 }

/** A name of an unturned symbol at (lx, ly) in the symbol's frame (CSS px, y up); its ink 5 px above and below its anchor. */
function name(text: string, lx: number, ly: number, side: PinName["side"], ink: { ascent: number; descent: number } = { ascent: 5, descent: 5 }): PinName {
  const align = side === "left" ? "left" : side === "right" ? "right" : "center"
  return { text, x: O.x + lx, y: O.y - ly, align, size: 10, ...ink, local: { x: lx, y: ly }, side, quarter: false }
}

/** A name of a symbol turned 90°: the frame's x axis runs up the screen, its y axis to the left. */
function turned(text: string, lx: number, ly: number, side: PinName["side"]): PinName {
  const baseline = side === "left" ? { ascent: 10, descent: 0 } : side === "right" ? { ascent: 0, descent: 10 } : { ascent: 5, descent: 5 }
  return { text, x: O.x - ly, y: O.y - lx, align: "center", size: 10, ...baseline, local: { x: lx, y: ly }, side, quarter: true }
}

describe("fitPinNames", () => {
  test("names facing each other that fit keep their text and size", () => {
    const names = [name("CC1", -50, 0, "left"), name("VBUS2", 50, 0, "right")]
    expect(fitPinNames(names, measure, 4)).toEqual([full("CC1"), full("VBUS2")])
  })

  test("a long name gives way to a short one it faces: it gets the rest of the room", () => {
    const names = [name("A", -20, 0, "left"), name("LONGNAME", 20, 0, "right")]
    // room 40 - 4 = 36; A takes 6, LONGNAME gets 30: at 70% it is 33.6, so six characters and the ellipsis
    expect(fitPinNames(names, measure, 4)).toEqual([full("A"), smaller("LONGNA…", 0.7)])
  })

  test("two long names facing each other share the room in halves", () => {
    const names = [name("ABCDEFGH", -20, 0, "left"), name("STUVWXYZ", 20, 0, "right")]
    expect(fitPinNames(names, measure, 4)).toEqual([smaller("ABC…", 0.7), smaller("STU…", 0.7)])
  })

  test("a name with no opposite name may reach its mirror across the body centre", () => {
    expect(fitPinNames([name("ABCDEF", -30, 0, "left")], measure, 4)).toEqual([full("ABCDEF")])
    expect(fitPinNames([name("ABCDEF", -15, 0, "left")], measure, 4)).toEqual([smaller("ABCDEF", 26 / 36)])
  })

  test("names on other rows do not limit each other", () => {
    const names = [name("ABCDEF", -20, 15, "left"), name("STUVWX", 20, -15, "right")]
    expect(fitPinNames(names, measure, 4)).toEqual([full("ABCDEF"), full("STUVWX")])
  })

  test("a connector's bottom names wider than their pitch are drawn smaller to fit their band, not dropped", () => {
    // 24 px apart, band 20: GND2 and GND1 (24 px) shrink to 20/24; EH fits
    const names = [name("GND2", -24, -20, "bottom"), name("GND1", 0, -20, "bottom"), name("EH", 24, -20, "bottom")]
    expect(fitPinNames(names, measure, 4)).toEqual([smaller("GND2", 20 / 24), smaller("GND1", 20 / 24), full("EH")])
  })

  test("bottom names too wide even at 70% are shortened with an ellipsis", () => {
    const names = [name("VBUS_IN", -10, -20, "bottom"), name("VBUS_OUT", 10, -20, "bottom")]
    expect(fitPinNames(names, measure, 4)).toEqual([smaller("VB…", 0.7), smaller("VB…", 0.7)])
  })

  test("names stacked on one side far enough apart are all kept", () => {
    const names = [name("A", -30, 12, "left"), name("B", -30, 0, "left"), name("C", -30, -12, "left")]
    expect(fitPinNames(names, measure, 4)).toEqual([full("A"), full("B"), full("C")])
  })

  test("stacked names whose ink overlaps are dropped", () => {
    const names = [name("A", -30, 4, "left"), name("B", -30, -4, "left")]
    expect(fitPinNames(names, measure, 4)).toEqual([null, null])
  })

  test("a side name next to a bottom row that is dropped stays; one that still overlaps another goes with it", () => {
    // the bottom names are 12 px apart: too close for two characters even at 70%
    const names = [name("CC2", -40, 0, "left"), name("GND2", -30, -6, "bottom"), name("GND1", -18, -6, "bottom")]
    expect(fitPinNames(names, measure, 4)).toEqual([full("CC2"), null, null])
    const lone = [name("CC2", -40, 0, "left"), name("EH", -30, -6, "bottom")]
    expect(fitPinNames(lone, measure, 4)).toEqual([null, null])
  })

  test("the overlap uses the real ink: a descender that reaches the row below drops both, capitals clear it", () => {
    const below = name("EH", -30, -10, "bottom", { ascent: 4, descent: 0 })
    const lower = name("gpio", -40, 0, "left", { ascent: 4, descent: 7 })
    const caps = name("GPIO", -40, 0, "left", { ascent: 4, descent: 3 })
    expect(fitPinNames([lower, below], measure, 4)).toEqual([null, null])
    expect(fitPinNames([caps, below], measure, 4)).toEqual([full("GPIO"), full("EH")])
  })

  test.each([90, 270])("on a box turned %i°, names on every side that fit are all kept", (degrees) => {
    const flip = degrees === 270 ? -1 : 1
    const at = (text: string, lx: number, ly: number, side: PinName["side"]) => {
      const n = turned(text, lx, ly, side)
      return flip === 1 ? n : { ...n, x: 2 * O.x - n.x, y: 2 * O.y - n.y, ascent: n.descent, descent: n.ascent }
    }
    const names = [
      at("T1", -24, 20, "top"),
      at("T2", 0, 20, "top"),
      at("T3", 24, 20, "top"),
      at("B1", -24, -20, "bottom"),
      at("B2", 0, -20, "bottom"),
      at("B3", 24, -20, "bottom"),
      at("IN", -40, 12, "left"),
      at("EN", -40, -12, "left"),
      at("OUT", 40, 12, "right"),
      at("PG", 40, -12, "right"),
    ]
    expect(fitPinNames(names, measure, 4)).toEqual(names.map((n) => full(n.text)))
  })
})
