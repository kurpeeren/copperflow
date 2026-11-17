import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { runCli } from "../src/cli-commands.js"
import { exportPackage } from "../src/core/bom.js"
import { pinMapParts, pinRows } from "../src/core/pin-map.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const EXAMPLES = join(import.meta.dirname, "..", "examples")
let root: string

beforeEach(async () => {
  // The real path: on Windows the temp folder can be an 8.3 short name, and the program compares real paths.
  root = await realpath(await mkdtemp(join(tmpdir(), "cf-pins-")))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function cli(...args: string[]): Promise<{ code: number; text: string }> {
  const out: string[] = []
  const code = await runCli(args, root, { out: (s) => out.push(s), err: (s) => out.push(s) }, { engine: inProcessEngine })
  return { code, text: out.join("\n") }
}

const row = (pad: string, pin: string, type: string, net?: string, origin: "given" | "made up" = "given") => ({ pad, pin, type, net: net ?? "not connected", ...(net ? { origin } : {}) })

describe("the pin map of can-node", () => {
  beforeEach(async () => {
    await cp(join(EXAMPLES, "can-node"), root, { recursive: true })
  })

  test("U101 has a row per pad: name, type, net and who named it", async () => {
    const design = await inProcessEngine.build(root, "can-node.circuit.tsx")
    expect(pinRows(design, "U101")).toEqual([
      row("1", "TXCAN", "output", "CAN1/TXCAN"),
      row("2", "RXCAN", "input", "CAN1/RXCAN"),
      row("3", "CLKOUT", "output"),
      row("4", "TX0RTS", "input"),
      row("5", "TX1RTS", "input"),
      row("6", "TX2RTS", "input"),
      row("7", "OSC2", "output", "CAN1/OSC2"),
      row("8", "OSC1", "input", "CAN1/OSC1"),
      row("9", "VSS", "ground", "GND"),
      row("10", "RX1BF", "output"),
      row("11", "RX0BF", "output"),
      row("12", "INT", "output", "INT"),
      row("13", "SCK", "input", "SCK"),
      row("14", "SI", "input", "MOSI"),
      row("15", "SO", "output", "MISO"),
      row("16", "CS", "input", "CS"),
      row("17", "RESET", "input", "CAN1/RESET"),
      row("18", "VDD", "power_in", "V3V3"),
    ])
  })

  test("with no part, every library chip and every connector, in name order", async () => {
    const design = await inProcessEngine.build(root, "can-node.circuit.tsx")
    expect(pinMapParts(design)).toEqual(["J1", "J2", "J3", "JP1", "U101", "U102"])
  })

  test("md is a table per part, csv one table with a part column", async () => {
    const md = await cli("pins", "can-node.circuit.tsx", "--part", "U102")
    expect(md.code).toBe(0)
    expect(md.text).toBe(
      [
        "## U102: TJA1051T/3 high-speed CAN transceiver with VIO, SO8",
        "",
        "| Pad | Pin | Type | Net | Net name |",
        "| --- | --- | --- | --- | --- |",
        "| 1 | TXD | input | CAN1/TXCAN | given |",
        "| 2 | GND | ground | GND | given |",
        "| 3 | VCC | power_in | V5 | given |",
        "| 4 | RXD | output | CAN1/RXCAN | given |",
        "| 5 | VIO | power_in | V3V3 | given |",
        "| 6 | CANL | bidirectional | CANL | given |",
        "| 7 | CANH | bidirectional | CANH | given |",
        "| 8 | S | input | GND | given |",
      ].join("\n"),
    )
    const csv = await cli("pins", "can-node.circuit.tsx", "--format", "csv")
    const lines = csv.text.split("\n")
    expect(lines[0]).toBe("Part,Pad,Pin,Type,Net,Net name")
    expect(lines).toContain("J1,7,CS,passive,CS,given")
    expect(lines).toContain("U101,3,CLKOUT,output,not connected,")
  })

  test("c is a header: a define per wired pin, and the reverse for each named signal net", async () => {
    const { code, text } = await cli("pins", "can-node.circuit.tsx", "--part", "U101", "--format", "c")
    expect(code).toBe(0)
    const lines = text.split("\n")
    expect(lines).toContain("#ifndef U101_PINS_H")
    expect(lines).toContain("#define U101_PINS_H")
    expect(lines.at(-1)).toBe("#endif")
    expect(lines).toContain("/* U101: MCP2515 stand-alone CAN controller with SPI, SOIC-18 wide, pins as wired in can-node.circuit.tsx */")
    expect(text).toMatch(/\n#define U101_CS_NET +"CS" +\/\* pad 16, input \*\/\n/)
    expect(text).toMatch(/\n#define U101_VDD_NET +"V3V3" +\/\* pad 18, power_in \*\/\n/)
    expect(text).toContain("\n/* U101 CLKOUT: pad 3, output, not connected */\n")
    expect(text).toMatch(/\n#define CS_PIN +"CS" +\/\* U101 pad 16 \*\/\n/)
    expect(text).toMatch(/\n#define CS_PIN_ID +CS\n/)
    expect(text).toMatch(/\n#define CAN1_TXCAN_PIN +"TXCAN" +\/\* U101 pad 1 \*\/\n/)
    // Power and ground are not signals: no reverse define for them.
    expect(text).not.toMatch(/V3V3_PIN|GND_PIN/)
  })

  test("names that collide get the pad number, and the header says so", async () => {
    const { text } = await cli("pins", "can-node.circuit.tsx", "--format", "c")
    expect(text).toContain("#ifndef CAN_NODE_PINS_H")
    // CS reaches U101 pad 16 and J1 pad 7.
    expect(text).toMatch(/\n#define CS_PIN_7 +"CS" +\/\* J1 pad 7 \*\/\n/)
    expect(text).toMatch(/\n#define CS_PIN_16 +"CS" +\/\* U101 pad 16 \*\/\n/)
    expect(text).toMatch(/\n\/\* Names that collided have the pad number added: [^\n]*CS_PIN_16[^\n]*\*\/\n/)
    expect(text).not.toMatch(/\n#define CS_PIN /)
  })

  test("the same design gives the same bytes", async () => {
    const first = await cli("pins", "can-node.circuit.tsx", "--format", "c")
    const second = await cli("pins", "can-node.circuit.tsx", "--format", "c")
    expect(second.text).toBe(first.text)
  })

  test("a part that does not exist is refused with the parts there are", async () => {
    const { code, text } = await cli("pins", "can-node.circuit.tsx", "--part", "U9")
    expect(code).not.toBe(0)
    expect(text).toContain("No part named U9 in can-node.circuit.tsx. Parts: C101, C102, C103, C104, C105, J1, J2, J3, JP1, R101, R102, U101, U102, Y101")
  })

  test("a net the build named is shown as made up and left out of the reverse list", async () => {
    const sheet = join(root, "CanNode.sheet.tsx")
    const text = (await readFile(sheet, "utf8"))
      .replace('<trace from="U1.RESET" to="net.RESET" />', '<trace from="U1.RESET" to="R1.pin2" />')
      .replace('<trace from="R1.pin2" to="net.RESET" />\n', "")
    await writeFile(sheet, text)
    const design = await inProcessEngine.build(root, "can-node.circuit.tsx")
    const reset = pinRows(design, "U101").find((r) => r.pin === "RESET")
    expect(reset?.origin).toBe("made up")
    const header = await cli("pins", "can-node.circuit.tsx", "--part", "U101", "--format", "c")
    expect(header.text).toContain("\n/* U101 RESET: pad 17, input, on a net with no name */\n")
    expect(header.text).not.toMatch(/RESET_PIN/)
  })

  test("export_package writes pins.md and a header per library chip, and lists them", async () => {
    const result = await exportPackage(root, "can-node.circuit.tsx", { engine: inProcessEngine })
    expect(result.files).toEqual(expect.arrayContaining(["exports/can-node/pins.md", "exports/can-node/U101_pins.h", "exports/can-node/U102_pins.h"]))
    expect(await readFile(join(root, "exports", "can-node", "U101_pins.h"), "utf8")).toBe(`${(await cli("pins", "can-node.circuit.tsx", "--part", "U101", "--format", "c")).text}\n`)
    expect(await readFile(join(root, "exports", "can-node", "pins.md"), "utf8")).toBe(`${(await cli("pins", "can-node.circuit.tsx")).text}\n`)
  })
})

describe("the pin map of io-8", () => {
  beforeEach(async () => {
    await cp(join(EXAMPLES, "io-8"), root, { recursive: true })
  })

  test("its connectors are the parts, and a pin flagged open is not connected", async () => {
    const design = await inProcessEngine.build(root, "io-8.circuit.tsx")
    expect(pinMapParts(design)).toEqual(["J1", "J2"])
    const j2 = pinRows(design, "J2")
    expect(j2[0]).toEqual(row("1", "DI1", "passive", "DI1"))
    expect(j2[9]).toEqual(row("10", "NC", "passive"))
    expect(pinRows(design, "J1")[8]).toEqual(row("9", "V24", "passive"))
  })

  test("the header has a reverse define per input, and none for ground", async () => {
    const { text } = await cli("pins", "io-8.circuit.tsx", "--format", "c")
    expect(text).toMatch(/\n#define IN1_PIN +"IN1" +\/\* J1 pad 1 \*\/\n/)
    expect(text).toMatch(/\n#define DI8_PIN +"DI8" +\/\* J2 pad 8 \*\/\n/)
    expect(text).not.toMatch(/GND_PIN/)
  })

  test("export_package writes pins.md and no header: io-8 has no library chip", async () => {
    const result = await exportPackage(root, "io-8.circuit.tsx", { engine: inProcessEngine })
    expect(result.files).toContain("exports/io-8/pins.md")
    expect(result.files.filter((f) => f.endsWith(".h"))).toEqual([])
  })
})
