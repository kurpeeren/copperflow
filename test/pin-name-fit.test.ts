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

const name = (text: string, x: number, y: number, align: PinName["align"]): PinName => ({ text, x, y, align, height: 10 })

describe("fitPinNames", () => {
  test("names facing each other that fit keep their text and size", () => {
    const names = [name("CC1", 0, 0, "left"), name("VBUS2", 100, 0, "right")]
    expect(fitPinNames(names, { x: 50, y: 0 }, measure, 4)).toEqual([full("CC1"), full("VBUS2")])
  })

  test("a long name gives way to a short one it faces: it gets the rest of the room", () => {
    const names = [name("A", 0, 0, "left"), name("LONGNAME", 40, 0, "right")]
    // room 40 - 4 = 36; A takes 6, LONGNAME gets 30: at 70% it is 33.6, so six characters and the ellipsis
    expect(fitPinNames(names, { x: 20, y: 0 }, measure, 4)).toEqual([full("A"), smaller("LONGNA…", 0.7)])
  })

  test("two long names facing each other share the room in halves", () => {
    const names = [name("ABCDEFGH", 0, 0, "left"), name("STUVWXYZ", 40, 0, "right")]
    expect(fitPinNames(names, { x: 20, y: 0 }, measure, 4)).toEqual([smaller("ABC…", 0.7), smaller("STU…", 0.7)])
  })

  test("a name with no opposite name may reach the mirrored anchor across the origin", () => {
    expect(fitPinNames([name("ABCDEF", 0, 0, "left")], { x: 30, y: 0 }, measure, 4)).toEqual([full("ABCDEF")])
    expect(fitPinNames([name("ABCDEF", 0, 0, "left")], { x: 15, y: 0 }, measure, 4)).toEqual([smaller("ABCDEF", 26 / 36)])
  })

  test("names on other rows do not limit each other", () => {
    const names = [name("ABCDEF", 0, 0, "left"), name("STUVWX", 40, 30, "right")]
    expect(fitPinNames(names, { x: 20, y: 15 }, measure, 4)).toEqual([full("ABCDEF"), full("STUVWX")])
  })

  test("a connector's bottom names wider than their pitch are drawn smaller to fit their band, not dropped", () => {
    // 24 px apart, band 20: GND2 and GND1 (24 px) shrink to 20/24; EH fits
    const names = [name("GND2", 0, 0, "center"), name("GND1", 24, 0, "center"), name("EH", 48, 0, "center")]
    expect(fitPinNames(names, { x: 24, y: -20 }, measure, 4)).toEqual([smaller("GND2", 20 / 24), smaller("GND1", 20 / 24), full("EH")])
  })

  test("bottom names too wide even at 70% are shortened with an ellipsis", () => {
    const names = [name("VBUS_IN", 0, 0, "center"), name("VBUS_OUT", 20, 0, "center")]
    expect(fitPinNames(names, { x: 10, y: -20 }, measure, 4)).toEqual([smaller("VB…", 0.7), smaller("VB…", 0.7)])
  })

  test("names stacked on one side far enough apart are all kept", () => {
    const names = [name("A", 0, 0, "left"), name("B", 0, 12, "left"), name("C", 0, 24, "left")]
    expect(fitPinNames(names, { x: 30, y: 12 }, measure, 4)).toEqual([full("A"), full("B"), full("C")])
  })

  test("stacked names closer than their height are dropped", () => {
    const names = [name("A", 0, 0, "left"), name("B", 0, 8, "left")]
    expect(fitPinNames(names, { x: 30, y: 4 }, measure, 4)).toEqual([null, null])
  })

  test("a side name next to a bottom row that is dropped stays; one that still overlaps another goes with it", () => {
    // the bottom names are 12 px apart: too close for two characters even at 70%
    const names = [name("CC2", 0, 0, "left"), name("GND2", 10, 6, "center"), name("GND1", 22, 6, "center")]
    expect(fitPinNames(names, { x: 40, y: -20 }, measure, 4)).toEqual([full("CC2"), null, null])
    const lone = [name("CC2", 0, 0, "left"), name("EH", 10, 6, "center")]
    expect(fitPinNames(lone, { x: 40, y: -20 }, measure, 4)).toEqual([null, null])
  })
})
