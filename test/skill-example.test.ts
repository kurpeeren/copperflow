// The worked example in skills/copperflow/references/design-workflow.md, run: its calls are accepted and its answers
// start the way the example shows.
import { beforeAll, describe, expect, test } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "sensor.circuit.tsx"
let client: Client

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}

const channel = { IN: "S1", OUT: "ADC1", GND: "GND" }

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-skill-example-"))
  const server = createCopperflowServer(root, { engine: inProcessEngine as never })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

describe("the two-channel sensor board of the skill", () => {
  test("runs from project_status to a placed board", async () => {
    expect((await call("project_status")).text).toMatch(/^No PROJECT\.md yet/)
    const intent = await call("set_project", { intent: "Two analog sensors on an ATtiny814.", blocks: [{ name: "Power", does: "LDO", status: "planned" }], open: ["choose parts"] })
    expect(intent.text).toMatch(/^Change c\d+: Intent, Blocks, Open written to PROJECT\.md$/)
    const ldo = await call("create_part", { id: "AP2112K-3.3", title: "AP2112K 3.3 V 600 mA LDO", manufacturer: "Diodes Inc.", mpn: "AP2112K-3.3TRG1", package: "sot23_5", pins: "1 VIN power_in\n2 GND ground\n3 EN input\n4 NC no_connect\n5 VOUT power_out", suppliers: { lcsc: "C51118" } })
    expect(ldo.text).toMatch(/^Created AP2112K-3.3: AP2112K 3.3 V 600 mA LDO, 5 pins, footprint sot23_5\./)
    const pins = ["VCC power_in", "PA4", "PA5", "PA6", "PA7", "PB3", "PB2", "PB1", "PB0", "UPDI", "PA1", "PA2", "PA3", "GND ground"]
    const mcu = await call("create_part", { id: "ATTINY814", title: "ATtiny814 8-bit MCU", manufacturer: "Microchip", mpn: "ATTINY814-SSN", package: "soic14", pins: pins.map((p, i) => `${i + 1} ${p.includes(" ") ? p : `${p} bidirectional`}`).join("\n") })
    expect(mcu.text).toMatch(/^Created ATTINY814: ATtiny814 8-bit MCU, 14 pins, footprint soic14\./)
    const written = await call("new_circuit", {
      file: FILE,
      place: false,
      sheets: {
        Power: {
          parts: [{ name: "U1", part: "AP2112K-3.3" }, { name: "C1", kind: "capacitor", value: "1uF", footprint: "0603" }, { name: "C2", kind: "capacitor", value: "1uF", footprint: "0603" }],
          nets: { VIN: ["U1.VIN", "U1.EN", "C1.pin1"], VOUT: ["U1.VOUT", "C2.pin1"], GND: ["U1.GND", "C1.pin2", "C2.pin2"] },
          ports: ["VIN", "VOUT", "GND"],
        },
        Channel: {
          parts: [{ name: "R1", kind: "resistor", value: "1k", footprint: "0402" }, { name: "C1", kind: "capacitor", value: "100nF", footprint: "0402" }],
          nets: { IN: ["R1.pin1"], OUT: ["R1.pin2", "C1.pin1"], GND: ["C1.pin2"] },
          ports: ["IN", "OUT", "GND"],
        },
      },
      instances: [
        { sheet: "Power", name: "PS1", connections: { VIN: "V5", VOUT: "V3_3", GND: "GND" } },
        { sheet: "Channel", name: "CH1", connections: channel },
        { sheet: "Channel", name: "CH2", connections: { ...channel, IN: "S2", OUT: "ADC2" } },
      ],
      parts: [{ name: "U1", part: "ATTINY814" }, { name: "C1", kind: "capacitor", value: "100nF", footprint: "0402" }, { name: "J1", kind: "pinheader", props: { pinCount: 4 } }, { name: "J2", kind: "pinheader", props: { pinCount: 3 } }],
      nets: { V5: ["J1.pin1"], GND: ["J1.pin2", "J2.pin3", "U1.GND", "C1.pin2"], S1: ["J1.pin3"], S2: ["J1.pin4"], V3_3: ["U1.VCC", "C1.pin1", "J2.pin1"], UPDI: ["U1.UPDI", "J2.pin2"], ADC1: ["U1.PA4"], ADC2: ["U1.PA5"] },    })
    expect(written.isError, written.text).toBe(false)
    expect(written.text.split("\n").slice(0, 7)).toEqual([
      expect.stringMatching(/^Change c\d+: wrote sensor\.circuit\.tsx, (Power|Channel)\.sheet\.tsx, (Power|Channel)\.sheet\.tsx$/),
      "4 parts, 3 instances",
      "PS1 Power base 100: VIN=V5 VOUT=V3_3 GND=GND",
      "CH1 Channel base 200: IN=S1 OUT=ADC1 GND=GND",
      "CH2 Channel base 300: IN=S2 OUT=ADC2 GND=GND",
      "8 nets, 14 traces",
      "Now call check_circuit once.",
    ])
    expect((await call("check_circuit", { file: FILE })).text).toMatch(/^sensor\.circuit\.tsx: 0 errors, \d+ warnings/)
    expect((await call("note_decision", { file: FILE, text: "Schematic approved" })).text).toMatch(/^Change c\d+: noted under Decisions in PROJECT\.md$/)
    expect((await call("note_open", { text: "human: verify AP2112K-3.3 and ATTINY814" })).text).toMatch(/^Change c\d+: added to Open in PROJECT\.md \(2 open items\)$/)
    expect((await call("autoplace", { file: FILE, parts: ["U1", "C1"] })).text).toMatch(/^Placed 2 parts; wire length \d+ mm \(was \d+\); board 30 × 20 mm; 0 overlaps\nChange c\d+; undo_change takes it back\./)
    for (const instance of ["PS1", "CH1"]) expect((await call("autoplace", { file: FILE, instance })).text).toMatch(/^Placed \d+ parts/)
    // CH2 shares Channel.sheet.tsx with CH1, so it took CH1's layout; autoplace moves it as a block by its anchor.
    const ch2 = await call("autoplace", { file: FILE, instance: "CH2" })
    expect(ch2.text).toMatch(/^Placed 2 parts; wire length \d+ mm \(was \d+\); board 30 × 20 mm; 0 overlaps\nChange c\d+; undo_change takes it back\.\nNotes: CH2 was moved as a block, keeping the arrangement of CH1$/)
    expect((await call("autoplace", { file: FILE, parts: ["J1", "J2"] })).text).toMatch(/^Placed 2 parts/)
    expect((await call("fit_board", { file: FILE })).text).toMatch(/^Change c\d+: board [\d.]+ × [\d.]+ mm \(margin 2 mm\)$/)
    expect((await call("board_summary", { file: FILE })).text).toMatch(/^sensor\.circuit\.tsx: Board [\d.]+ × [\d.]+ mm, 2 layers, courtyards use \d+%; 11 parts, \d+ nets/)
    // A placed instance stays where it is: nothing to place.
    expect((await call("autoplace", { file: FILE, instance: "CH1" })).text).toMatch(/^Nothing to place/)
    expect((await call("add_pour", { file: FILE, net: "GND", layer: "top" })).text).toMatch(/^Change c\d+: added copperpour:1 \(GND, top\)\ncopperpour:1 GND top: [\d.]+ mm², joins \d+ pads/)
    expect((await call("add_pour", { file: FILE, net: "GND", layer: "bottom" })).text).toMatch(/^Change c\d+: added copperpour:2 \(GND, bottom\)/)
    const byRef = await call("route_track", { file: FILE, from: "R201.pin2", to: "U1.PA4" })
    expect(byRef.text).toMatch(/^Change c\d+: routed ADC1 R201\.pin2 \(-?[\d.]+, -?[\d.]+ top\) to U1\.pin2 \(-?[\d.]+, -?[\d.]+ top\): \d+ tracks?, \d+ vias?/)
    const routed = await call("autoroute", { file: FILE })
    expect(routed.text).toMatch(/^Change c\d+: Routed (\d+) of \1 connections? in \d+ pass(es)?/)
    const checked = (await call("check_circuit", { file: FILE })).text
    expect(checked).toMatch(/^sensor\.circuit\.tsx: 0 errors, \d+ warnings/)
    expect(checked).not.toMatch(/unrouted/)
    expect((await call("export_fabrication", { file: FILE })).text).toMatch(/^Wrote \d+ files to sensor-fab\/ and sensor-fab\.zip:/)
  }, 60_000)

  test("a wide SOIC part from create_part, with its unused inputs flagged no connect", async () => {
    const names = ["TXCAN", "RXCAN", "CLKOUT", "TX0RTS", "TX1RTS", "TX2RTS", "OSC2", "OSC1", "VSS ground", "RX1BF", "RX0BF", "INT", "SCK", "SI", "SO", "CS", "RESET", "VDD power_in"]
    const pins = names.map((p, i) => `${i + 1} ${p.includes(" ") ? p : `${p} bidirectional`}`).join("\n")
    const created = await call("create_part", { id: "MCP2515", title: "MCP2515 CAN controller", manufacturer: "Microchip", mpn: "MCP2515-I/SO", package: "soic18w", pins })
    expect(created.text).toMatch(/^Created MCP2515: MCP2515 CAN controller, 18 pins, footprint soic18w\./)
    const file = "can.circuit.tsx"
    const written = await call("new_circuit", { file, place: false, parts: [{ name: "U1", part: "MCP2515" }, { name: "J1", kind: "pinheader", props: { pinCount: 2, pinLabels: { pin1: "V5", pin2: "GND" } } }], nets: { GND: ["U1.VSS", "J1.pin2"], V5: ["U1.VDD", "J1.pin1"] } })
    expect(written.isError, written.text).toBe(false)
    const listed = await call("new_circuit", { file: "list.circuit.tsx", place: false, parts: [{ name: "J1", kind: "pinheader", props: { pinCount: 2, pinLabels: ["V5", "GND"] } }], nets: {} })
    expect(listed.isError).toBe(true)
    expect(listed.text).toMatch(/Invalid input at parts\[0\]\.props\.pinLabels/)
    const inline = await call("new_circuit", { file: "nc.circuit.tsx", place: false, parts: [{ name: "U1", part: "MCP2515", props: { noConnect: "pin3,pin4" } }], nets: { GND: ["U1.VSS"] } })
    expect(inline.isError, inline.text).toBe(false)
    const flagged = (await call("check_circuit", { file: "nc.circuit.tsx", filter: "U1" })).text
    expect(flagged).toMatch(/pin-unconnected/)
    expect(flagged).not.toMatch(/U1\.pin3\b/)
    expect(flagged).not.toMatch(/U1\.pin4\b/)
    const unused = "TXCAN,RXCAN,CLKOUT,TX0RTS,TX1RTS,TX2RTS,OSC2,OSC1,RX1BF,RX0BF,INT,SCK,SI,SO,CS,RESET"
    expect((await call("set_props", { file, part: "U1", props: { noConnect: unused } })).isError).toBe(false)
    const checked = await call("check_circuit", { file, filter: "U1" })
    expect(checked.text).not.toMatch(/pin-unconnected/)
    expect(checked.text).not.toMatch(/footprint/)
  }, 60_000)
})
