import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../../src/engine/design.js"
import { placeBoard } from "../../src/engine/pcb-place/index.js"
import { filesIn, withPositions } from "../helpers/place-fixtures.js"
/** The shortest pad-to-pad distance between `a`'s and `b`'s pads on `net` (mm). */
function onNet(design: Design, a: string, b: string, net: string): number {
  const of = (part: string) => design.pcb.parts.find((p) => p.component === part)?.pads.filter((p) => p.net === net) ?? []
  return Math.min(...of(a).flatMap((p) => of(b).map((q) => Math.hypot(p.x - q.x, p.y - q.y))))
}

interface Bus {
  canh: number
  canl: number
  term: number
  wire: number
}

/** Places `files` (connectors last only, when `old`) and builds the board with those positions. */
function placed(files: Record<string, string>, main: string, old = false): { design: Design; wire: number } {
  const placement = placeBoard(buildDesign(files, main), old ? { connectorsAhead: false } : {})
  expect(placement.unplaced).toEqual([])
  return { design: buildDesign({ ...files, [main]: withPositions(files[main] as string, placement.positions) }, main), wire: placement.score.wireLength }
}

/** Places `files` and measures the bus nets on the placed board. */
function measure(files: Record<string, string>, main: string, nets: { canh: [string, string]; term: [string, string] }, old = false): Bus {
  const { design, wire } = placed(files, main, old)
  return {
    canh: onNet(design, ...nets.canh, "net.CANH"),
    canl: onNet(design, ...nets.canh, "net.CANL"),
    term: onNet(design, ...nets.term, "net.TERM"),
    wire,
  }
}

const PROOF = join(import.meta.dirname, "..", "fixtures", "can-proof-3")
const PROOF_MAIN = "can-module.circuit.tsx"
const PROOF_LAYOUT = "can-module.circuit.layout.json"

/**
 * The CAN board of the third proof run (a CAN controller, the transceiver U2, the bus header J2 and the termination
 * jumper JP1 with its resistor R2, a crystal, decoupling, an SPI header) with nothing placed, on a `width` x `height`
 * mm board.
 */
function proofBoard(width: number, height: number): Record<string, string> {
  const files = filesIn(PROOF)
  const main = (files[PROOF_MAIN] as string)
    .replace(/ pcbX=\{[^}]*\} pcbY=\{[^}]*\} pcbRotation=\{[^}]*\}/g, "")
    .replace(/<board width=\{[^}]*\} height=\{[^}]*\} pcbX=\{[^}]*\}>/, `<board width={${width}} height={${height}}>`)
  return { ...files, [PROOF_MAIN]: main, [PROOF_LAYOUT]: `${(files[PROOF_LAYOUT] as string).split("\n")[0]}\n` }
}
const PROOF_NETS = { canh: ["J2", "U2"], term: ["JP1", "R2"] } as { canh: [string, string]; term: [string, string] }
const proof = (width: number, height: number, old = false) => measure(proofBoard(width, height), PROOF_MAIN, PROOF_NETS, old)

describe("the bus header of the proof board sits near the transceiver it serves", () => {
  // With connectors last only, these were 9.3 / 5.6 / 14.1, 20.6 / 15.4 / 23.7 and 25.5 / 20.3 / 34.1 mm.
  for (const [width, height] of [[32, 23], [30, 22], [44, 20]] as const) {
    test(`on ${width} x ${height} mm CANH, CANL and TERM are each at most 12 mm pad to pad`, () => {
      const bus = proof(width, height)
      expect(Math.max(bus.canh, bus.canl, bus.term)).toBeLessThanOrEqual(12)
    })
  }

  test("on 32 x 20 mm the bus nets together are shorter than with connectors last (37.3 mm then)", () => {
    const [bus, old] = [proof(32, 20), proof(32, 20, true)]
    expect(bus.canh + bus.canl + bus.term).toBeLessThan(old.canh + old.canl + old.term)
  })

  test("on 40 x 30 mm CANH and CANL are no longer than with connectors last (10.4 and 15.6 then), TERM within 0.5 mm (11.1)", () => {
    const [bus, old] = [proof(40, 30), proof(40, 30, true)]
    expect(bus.canh).toBeLessThanOrEqual(old.canh)
    expect(bus.canl).toBeLessThanOrEqual(old.canl)
    expect(bus.term).toBeLessThanOrEqual(old.term + 0.5)
  })

  test("the same board places the same way twice", () => {
    const files = proofBoard(32, 23)
    const once = placeBoard(buildDesign(files, PROOF_MAIN))
    const twice = placeBoard(buildDesign(files, PROOF_MAIN))
    expect([...twice.positions]).toEqual([...once.positions])
  })
})

const MAIN = "main.circuit.tsx"

/**
 * A board like the one in the hosted proof run, rebuilt from its description: a microcontroller, a CAN transceiver,
 * a 4-pin bus header wired to the transceiver and its split termination, a 3-pin power header wired to a regulator,
 * a crystal with its two load capacitors, and decoupling capacitors.
 */
const BODY = [
  `<chip name="U1" footprint="lqfp32" pinLabels={{ pin1: "VDD", pin2: "GND", pin3: "OSC1", pin4: "OSC2", pin5: "NRST", pin9: "VDD1", pin10: "GND1", pin17: "VDD2", pin18: "GND2", pin21: "TXD", pin22: "RXD", pin25: "VDD3", pin26: "GND3" }} />`,
  `<chip name="U2" footprint="soic8" pinLabels={{ pin1: "TXD", pin2: "GND", pin3: "VCC", pin4: "RXD", pin5: "VIO", pin6: "CANL", pin7: "CANH", pin8: "S" }} />`,
  `<chip name="U3" footprint="sot23" pinLabels={{ pin1: "GND", pin2: "VOUT", pin3: "VIN" }} />`,
  `<crystal name="Y1" frequency="8MHz" footprint="hc49s" />`,
  ...["C1", "C2"].map((name) => `<capacitor name="${name}" capacitance="22pF" footprint="0603" />`),
  ...["C3", "C4", "C7", "C8", "C9"].map((name) => `<capacitor name="${name}" capacitance="100nF" footprint="0603" />`),
  ...["C5", "C6"].map((name) => `<capacitor name="${name}" capacitance="1uF" footprint="0603" />`),
  `<resistor name="R1" resistance="60" footprint="0603" />`,
  `<resistor name="R2" resistance="10k" footprint="0603" />`,
  `<resistor name="R3" resistance="60" footprint="0603" />`,
  `<pinheader name="J1" pinCount={4} pitch="2.54mm" />`,
  `<pinheader name="J2" pinCount={3} pitch="2.54mm" />`,
  ...[
    ...["U1.pin1", "U1.pin9", "U1.pin17", "U1.pin25", "U2.pin3", "U2.pin5", "U3.pin2", "C3.pin1", "C4.pin1", "C6.pin1", "C7.pin1", "C8.pin1", "C9.pin1", "R2.pin1"].map((pin) => [pin, "net.V3"]),
    ...["U1.pin2", "U1.pin10", "U1.pin18", "U1.pin26", "U2.pin2", "U2.pin8", "U3.pin1", "C1.pin2", "C2.pin2", "C3.pin2", "C4.pin2", "C5.pin2", "C6.pin2", "C7.pin2", "C8.pin2", "C9.pin2", "J1.pin4", "J2.pin2"].map((pin) => [pin, "net.GND"]),
    ...["U3.pin3", "C5.pin1", "J2.pin1", "J2.pin3"].map((pin) => [pin, "net.VIN"]),
    ["U1.pin3", "net.OSC1"], ["Y1.pin1", "net.OSC1"], ["C1.pin1", "net.OSC1"],
    ["U1.pin4", "net.OSC2"], ["Y1.pin2", "net.OSC2"], ["C2.pin1", "net.OSC2"],
    ["U1.pin5", "net.NRST"], ["R2.pin2", "net.NRST"],
    ["U1.pin21", "net.CAN_TX"], ["U2.pin1", "net.CAN_TX"],
    ["U1.pin22", "net.CAN_RX"], ["U2.pin4", "net.CAN_RX"],
    ["U2.pin7", "net.CANH"], ["J1.pin1", "net.CANH"], ["R3.pin1", "net.CANH"],
    ["U2.pin6", "net.CANL"], ["J1.pin2", "net.CANL"], ["R1.pin1", "net.CANL"],
    ["J1.pin3", "net.TERM"], ["R1.pin2", "net.TERM"], ["R3.pin2", "net.TERM"],
  ].map(([from, to]) => `<trace from="${from}" to="${to}" />`),
].join("\n")

const rebuilt = (width: number, height: number) =>
  measure({ [MAIN]: `export default () => (\n  <board width="${width}mm" height="${height}mm">\n${BODY}\n  </board>\n)\n` }, MAIN, { canh: ["J1", "U2"], term: ["J1", "R1"] })

describe("the bus header of the rebuilt proof board sits near the transceiver", () => {
  for (const [width, height] of [[32, 23], [30, 22], [32, 20], [44, 20], [40, 30]] as const) {
    test(`on ${width} x ${height} mm CANH, CANL and TERM are each at most 12 mm pad to pad`, () => {
      const bus = rebuilt(width, height)
      expect(Math.max(bus.canh, bus.canl, bus.term)).toBeLessThanOrEqual(12)
    })
  }
})
