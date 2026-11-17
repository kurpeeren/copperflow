import { describe, expect, test } from "vitest"
import type { Net } from "../../src/engine/model.js"
import { netClasses } from "../../src/engine/rules/classes.js"
import { loadRules } from "../../src/engine/rules/load.js"
import { classPairs, PAIR_ENDINGS } from "../../src/engine/rules/pairs.js"
import { PROFILES } from "../../src/engine/rules/profiles.js"

const net = (name: string): Net => ({ id: `net.${name}`, names: [name], pins: [] })
const load = (text: string) => loadRules({ "rules.yaml": text })

describe("the board's stack (F1)", () => {
  test("the 2-layer profile carries the maker's stack", () => {
    const p = PROFILES["jlcpcb-2layer"]
    expect([p?.boardThickness, p?.permittivity, p?.copperThickness, p?.solderMask]).toEqual([1.6, 4.6, 0.035, true])
  })
  test("rules.yaml overrides each value", () => {
    const { rules, diagnostics } = load("fabrication:\n  boardThickness: 0.8\n  permittivity: 4.2\n  copperThickness: 0.07\n  solderMask: false\n  dielectricHeight: 0.7\n")
    expect(diagnostics).toEqual([])
    const f = rules.fabrication
    expect([f.boardThickness, f.permittivity, f.copperThickness, f.solderMask, f.dielectricHeight]).toEqual([0.8, 4.2, 0.07, false, 0.7])
  })
})

describe("net class keys (F3)", () => {
  test("each key is read", () => {
    const text = [
      "netClasses:",
      "  usb:",
      "    nets: [D+, D-]",
      "    pair: by-name",
      "    differentialImpedance: 90",
      "    gap: 0.2",
      "    maxSkew: 0.5",
      "    maxLength: 50",
      "  bus:",
      "    nets: [A0, A1]",
      "    impedance: 50",
      "    trackWidth: 0.3",
      "    matchGroup: addr",
      "    maxSpread: 2",
      "    pair: [[A0, A1]]",
      "",
    ].join("\n")
    const { rules, diagnostics } = load(text)
    expect(diagnostics).toEqual([])
    const [usb, bus] = rules.classes
    expect(usb).toMatchObject({ pair: "by-name", differentialImpedance: 90, gap: 0.2, maxSkew: 0.5, maxLength: 50 })
    expect(bus).toMatchObject({ impedance: 50, trackWidth: 0.3, matchGroup: "addr", maxSpread: 2, pair: [["A0", "A1"]] })
  })

  test("a width left out comes from the impedance, and says so", () => {
    const { rules } = load("netClasses:\n  rf:\n    nets: [RF]\n    impedance: 50\n")
    const rf = rules.classes[0]
    expect(rf?.trackWidth).toBeGreaterThan(2.5)
    expect(rf?.trackWidth).toBeLessThan(3.1)
    expect(rf?.widthFrom).toBe("50 ohm single")
  })

  test("a pair's width comes from its differential impedance at its gap", () => {
    const { rules } = load("netClasses:\n  can:\n    nets: [CANH, CANL]\n    pair: by-name\n    differentialImpedance: 120\n    gap: 0.2\n")
    const can = rules.classes[0]
    expect(can?.gap).toBe(0.2)
    expect(can?.widthFrom).toBe("120 ohm differential at a 0.2 mm gap")
    expect(can?.trackWidth).toBeGreaterThan(0.2)
  })

  test("a figure out of range is an error", () => {
    const { diagnostics } = load("netClasses:\n  rf:\n    nets: [RF]\n    impedance: 900\n")
    expect(diagnostics.map((d) => d.message)).toEqual(["rules.yaml:4: netClasses.rf.impedance: an impedance from 10 to 200 ohm"])
  })

  test("maxSpread without matchGroup is an error", () => {
    const { diagnostics } = load("netClasses:\n  b:\n    nets: [A]\n    maxSpread: 2\n")
    expect(diagnostics[0]?.message).toContain("maxSpread needs a matchGroup")
  })

  test("without a stack the width cannot be calculated, and the sentence says which value to set", () => {
    const { diagnostics } = load("fabrication:\n  profile: jlcpcb-4layer\nnetClasses:\n  rf:\n    nets: [RF]\n    impedance: 50\n")
    expect(diagnostics.map((d) => d.message)).toContain(
      "Net class rf: the impedance cannot be calculated: the profile jlcpcb-4layer gives no dielectricHeight; set fabrication.dielectricHeight in rules.yaml (and trackWidth uses 0.25 mm)",
    )
  })
})

describe("pairs by name", () => {
  test("the endings are listed", () => {
    expect(PAIR_ENDINGS).toEqual([["_P", "_N"], ["+", "-"], ["DP", "DM"], ["H", "L"]])
  })
  test("pairs each ending with its partner within the class", () => {
    const { rules } = load("netClasses:\n  fast:\n    nets: ['*']\n    pair: by-name\n")
    const nets = ["USB_P", "USB_N", "D+", "D-", "USBDP", "USBDM", "CANH", "CANL", "GND"].map(net)
    const pairs = classPairs(rules, nets, netClasses(rules, nets).byNet).pairs.map((p) => [p.a, p.b])
    expect(pairs).toEqual([["net.USB_P", "net.USB_N"], ["net.D+", "net.D-"], ["net.USBDP", "net.USBDM"], ["net.CANH", "net.CANL"]])
  })
  test("a listed pair naming a missing net, and a pair of one, are warnings", () => {
    const { rules } = load("netClasses:\n  fast:\n    nets: [A, B, C]\n    pair: [[A, Z], [C, C]]\n")
    const nets = ["A", "B", "C"].map(net)
    const found = classPairs(rules, nets, netClasses(rules, nets).byNet)
    expect(found.pairs).toEqual([])
    expect(found.diagnostics.map((d) => d.message)).toEqual([
      "Net class fast: the pair A and Z names Z, which is no net of the circuit",
      "Net class fast: the pair C and C names one net twice; a pair needs two nets",
    ])
  })
  test("a by-name class with a net left without a partner says so", () => {
    const { rules } = load("netClasses:\n  fast:\n    nets: [USB_P]\n    pair: by-name\n")
    const nets = [net("USB_P")]
    expect(classPairs(rules, nets, netClasses(rules, nets).byNet).diagnostics.map((d) => d.message)).toEqual([
      "Net class fast: USB_P has no partner (USB_N) in the class, so it is not a pair",
    ])
  })
})
