import { describe, expect, test } from "vitest"
import { fitPinNames, fitText, type PinName } from "../studio/src/pcb/pin-name-fit.js"

/** Every character is 6 px wide. */
const measure = (text: string) => text.length * 6

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

const name = (text: string, x: number, y: number, align: PinName["align"]): PinName => ({ text, x, y, align, height: 10 })

describe("fitPinNames", () => {
  test("names facing each other that fit keep their text", () => {
    const names = [name("CC1", 0, 0, "left"), name("VBUS2", 100, 0, "right")]
    expect(fitPinNames(names, { x: 50, y: 0 }, measure, 4)).toEqual(["CC1", "VBUS2"])
  })

  test("a long name gives way to a short one it faces: it gets the rest of the room", () => {
    const names = [name("A", 0, 0, "left"), name("LONGNAME", 40, 0, "right")]
    // room 40 - 4 = 36; A takes 6, LONGNAME gets 30: four characters and the ellipsis
    expect(fitPinNames(names, { x: 20, y: 0 }, measure, 4)).toEqual(["A", "LONG…"])
  })

  test("two long names facing each other share the room in halves", () => {
    const names = [name("ABCDEFGH", 0, 0, "left"), name("STUVWXYZ", 40, 0, "right")]
    // room 36, 18 each: two characters and the ellipsis
    expect(fitPinNames(names, { x: 20, y: 0 }, measure, 4)).toEqual(["AB…", "ST…"])
  })

  test("a name with no opposite name may reach the mirrored anchor across the origin", () => {
    expect(fitPinNames([name("ABCDEFGHIJ", 0, 0, "left")], { x: 20, y: 0 }, measure, 4)).toEqual(["ABCDE…"])
  })

  test("names on other rows do not limit each other", () => {
    const names = [name("ABCDEF", 0, 0, "left"), name("STUVWX", 40, 30, "right")]
    expect(fitPinNames(names, { x: 20, y: 15 }, measure, 4)).toEqual(["ABCDEF", "STUVWX"])
  })

  test("neighbouring names on one side whose boxes overlap are both dropped, never drawn over each other", () => {
    // a connector's bottom names, 12 px apart and centred: GND2 and GND1 overlap, as do GND1 and EH
    const names = [name("GND2", 0, 0, "center"), name("GND1", 12, 0, "center"), name("EH", 24, 0, "center"), name("ID", 60, 0, "center")]
    expect(fitPinNames(names, { x: 30, y: -20 }, measure, 4)).toEqual([null, null, null, "ID"])
  })

  test("names stacked on one side far enough apart are all kept", () => {
    const names = [name("A", 0, 0, "left"), name("B", 0, 12, "left"), name("C", 0, 24, "left")]
    expect(fitPinNames(names, { x: 30, y: 12 }, measure, 4)).toEqual(["A", "B", "C"])
  })

  test("stacked names closer than their height are dropped", () => {
    const names = [name("A", 0, 0, "left"), name("B", 0, 8, "left")]
    expect(fitPinNames(names, { x: 30, y: 4 }, measure, 4)).toEqual([null, null])
  })
})
