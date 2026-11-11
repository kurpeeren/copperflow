// The pin table a person pastes from a datasheet: three table styles, the header, defaults and the errors per line.
import { describe, expect, test } from "vitest"
import { parsePinTable, pinTableText } from "../src/library/pin-table.js"

describe("pasting a pin table", () => {
  test("space separated, as typed: '1 VDD power_in', with a header line skipped", () => {
    const table = parsePinTable(["Pin Name Type", "1 VDD power_in", "2 GND ground", "3 SCL bidirectional", "4 NC no_connect"].join("\n"))
    expect(table.errors).toEqual([])
    expect(table.pins).toEqual([
      { number: "1", name: "VDD", type: "power_in" },
      { number: "2", name: "GND", type: "ground" },
      { number: "3", name: "SCL", type: "bidirectional" },
      { number: "4", name: "NC", type: "no_connect" },
    ])
  })

  test("tab separated, copied from a PDF table with a description column", () => {
    const text = ["PIN\tNAME\tTYPE\tDESCRIPTION", "1\tTXCAN\toutput\tTransmit output to the CAN transceiver", "2\tRXCAN\tinput\tReceive input", "", "9\tVSS\tGround\tGround reference", "18\tVDD\tPower-In\tPositive supply"].join("\r\n")
    const table = parsePinTable(text)
    expect(table.errors).toEqual([])
    expect(table.pins).toEqual([
      { number: "1", name: "TXCAN", type: "output", description: "Transmit output to the CAN transceiver" },
      { number: "2", name: "RXCAN", type: "input", description: "Receive input" },
      { number: "9", name: "VSS", type: "ground", description: "Ground reference" },
      { number: "18", name: "VDD", type: "power_in", description: "Positive supply" },
    ])
  })

  test("comma separated and multiple-space aligned tables; a pin without a type is passive", () => {
    const csv = parsePinTable("No., Name, Type\n3, SCL, bidirectional\n4, SDA\n5, OSC1, input")
    expect(csv.errors).toEqual([])
    expect(csv.pins).toEqual([
      { number: "3", name: "SCL", type: "bidirectional" },
      { number: "4", name: "SDA", type: "passive" },
      { number: "5", name: "OSC1", type: "input" },
    ])
    const aligned = parsePinTable(["1    XTAL1    passive", "2    XTAL2", "3    GND      ground    Case ground, both legs"].join("\n"))
    expect(aligned.errors).toEqual([])
    expect(aligned.pins).toEqual([
      { number: "1", name: "XTAL1", type: "passive" },
      { number: "2", name: "XTAL2", type: "passive" },
      { number: "3", name: "GND", type: "ground", description: "Case ground, both legs" },
    ])
  })

  test("a comma table with one line without a comma reads the other lines and reports that one", () => {
    const table = parsePinTable("1, VDD, power_in\n2, GND, ground\n3")
    expect(table.pins.map((pin) => pin.name)).toEqual(["VDD", "GND"])
    expect(table.errors.map((error) => error.message)).toEqual(["Line 3: pin 3 has no name"])
  })

  test("in an aligned table a single-spaced line keeps its description's words together", () => {
    const table = parsePinTable("1    VDD    power_in    Supply\n4 SDA input Serial data")
    expect(table.pins[1]).toEqual({ number: "4", name: "SDA", type: "input", description: "Serial data" })
  })

  test("a header with a digit is skipped when it names its columns", () => {
    expect(parsePinTable("Pin Name Type (Note 1)\n1 VDD power_in").errors).toEqual([])
    expect(parsePinTable("Pin No. 1-28, Name, Type\n1, VDD, power_in").pins).toHaveLength(1)
  })

  test("an unknown type word is reported on its line, not guessed; the other pins are kept", () => {
    const table = parsePinTable("1 VDD P\n2 GND ground\n3 SDA I/O")
    expect(table.pins).toEqual([{ number: "2", name: "GND", type: "ground" }])
    expect(table.errors).toEqual([
      { line: 1, text: "1 VDD P", message: 'Line 1: "P" is not a pin type; use power_in, power_out, ground, input, output, bidirectional, passive or no_connect' },
      { line: 3, text: "3 SDA I/O", message: 'Line 3: "I/O" is not a pin type; use power_in, power_out, ground, input, output, bidirectional, passive or no_connect' },
    ])
  })

  test("a repeated number, a bad number, a bad name and a missing name are each reported", () => {
    const table = parsePinTable("1 VDD power_in\n2 GND ground\n1 VCC power_in\nA1 X passive\n5 +3V3 power_in\n6")
    expect(table.pins.map((pin) => pin.number)).toEqual(["1", "2"])
    expect(table.errors.map((error) => error.message)).toEqual([
      "Line 3: pin 1 is already on line 1",
      'Line 4: "A1" is not a pin number; pins are numbered 1, 2, 3 …',
      'Line 5: "+3V3" is not a pin name; use letters, digits and _, starting with a letter (e.g. _3V3)',
      "Line 6: pin 6 has no name",
    ])
  })

  test("only the first line can be a header; a later line that is not a pin is an error", () => {
    expect(parsePinTable("Pin, Name\n1, A").errors).toEqual([])
    expect(parsePinTable("1, A\nPin, Name").errors.map((e) => e.message)).toEqual(['Line 2: "Pin" is not a pin number; pins are numbered 1, 2, 3 …'])
    expect(parsePinTable("  \n\n").pins).toEqual([])
  })

  test("the rows as text again, tab separated, for the paste area", () => {
    const text = pinTableText([
      { number: "1", name: "VDD", type: "power_in" },
      { number: "2", name: "GND", type: "ground", description: "Ground" },
    ])
    expect(text).toBe("1\tVDD\tpower_in\n2\tGND\tground\tGround")
    expect(parsePinTable(text).pins).toHaveLength(2)
  })
})
