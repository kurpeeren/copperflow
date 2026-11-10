import { describe, expect, test } from "vitest"
import type { Net } from "../src/engine/model.js"
import { DEFAULT_CLASS, PROFILES } from "../src/engine/rules/profiles.js"
import type { Rules } from "../src/engine/rules/schema.js"
import { defaultVia, netName, routeNet, trackWidth, viaSize } from "../studio/src/pcb/track-rules.js"

const net = (id: string, names: string[]): Net => ({ id, names, pins: [] }) as unknown as Net
const rules = (classes: Rules["classes"] = []): Rules => ({ fabrication: PROFILES["jlcpcb-2layer"] as Rules["fabrication"], classes, classClearance: [], globalNets: [] })
const power = { name: "power", trackWidth: 0.6, clearance: 0.3, via: { drill: 0.4, diameter: 0.8 }, patterns: ["V*"] }

describe("the track tool's width rule", () => {
  test("a net in a class from rules.yaml takes that class's width and via", () => {
    expect(trackWidth(rules([power]), net("net.VBUS", ["VBUS"]))).toBe(0.6)
    expect(viaSize(rules([power]), net("net.VBUS", ["VBUS"]))).toEqual({ drill: 0.4, diameter: 0.8 })
  })

  test("a via on no net gets the default class's via, grown the same way", () => {
    expect(defaultVia(rules())).toEqual({ drill: 0.3, diameter: 0.66 })
    expect(defaultVia({ ...rules(), fabrication: PROFILES["jlcpcb-4layer"] as Rules["fabrication"] })).toEqual({ drill: 0.3, diameter: 0.6 })
  })

  test("any other net takes the design rules' default width and via", () => {
    expect(trackWidth(rules([power]), net("net.GND", ["GND"]))).toBe(DEFAULT_CLASS.trackWidth)
    expect(trackWidth(rules(), net("net.GND", ["GND"]))).toBe(0.25)
    expect(viaSize(rules(), net("net.GND", ["GND"]))).toEqual({ drill: 0.3, diameter: 0.66 })
  })

  test("the via is never smaller than its drill plus the profile's annular ring on both sides", () => {
    const ring = PROFILES["jlcpcb-2layer"]!.minAnnularRing
    const via = viaSize(rules(), net("net.GND", ["GND"]))
    expect((via.diameter - via.drill) / 2).toBeCloseTo(ring, 9)
    const loose = { ...rules(), fabrication: { ...rules().fabrication, minAnnularRing: 0.1 } }
    expect(viaSize(loose, net("net.GND", ["GND"]))).toEqual({ drill: 0.3, diameter: 0.6 })
    expect(viaSize(rules([power]), net("net.VBUS", ["VBUS"]))).toEqual({ drill: 0.4, diameter: 0.8 })
  })

  test("a via on no net gets the default class's via, grown the same way", () => {
    expect(defaultVia(rules())).toEqual({ drill: 0.3, diameter: 0.66 })
    expect(defaultVia({ ...rules(), fabrication: PROFILES["jlcpcb-4layer"] as Rules["fabrication"] })).toEqual({ drill: 0.3, diameter: 0.6 })
  })

  test("a class below the fabrication minimums is raised to them; one that meets them keeps its values", () => {
    const thin = { name: "thin", trackWidth: 0.05, clearance: 0.1, via: { drill: 0.1, diameter: 0.5 }, patterns: ["S*"] }
    const sig = net("net.SIG", ["SIG"])
    expect(trackWidth(rules([thin]), sig)).toBe(0.1)
    expect(viaSize(rules([thin]), sig)).toEqual({ drill: 0.15, diameter: 0.51 })
    const exact = { ...thin, trackWidth: 0.1, via: { drill: 0.15, diameter: 0.6 } }
    expect(trackWidth(rules([exact]), sig)).toBe(0.1)
    expect(viaSize(rules([exact]), sig)).toEqual({ drill: 0.15, diameter: 0.6 })
    expect(trackWidth(rules([power]), net("net.VBUS", ["VBUS"]))).toBe(0.6)
  })

  test("routeNet gathers the net's id, its name, the width and the via; an unknown id gives none", () => {
    const design = { rules: rules([power]), circuit: { nets: [net("net.VBUS", ["VBUS"]), net("net:R1.pin1", [])] } }
    expect(routeNet(design, "net.VBUS")).toEqual({ id: "net.VBUS", name: "VBUS", width: 0.6, via: { drill: 0.4, diameter: 0.8 } })
    expect(routeNet(design, "net:R1.pin1")?.name).toBe("net:R1.pin1")
    expect(routeNet(design, "net.nothing")).toBeUndefined()
    expect(netName(design, "net.VBUS")).toBe("VBUS")
    expect(netName(design, undefined)).toBe("no net")
  })
})
