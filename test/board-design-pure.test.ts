// The pure parts behind set_rules, fit_board's size, the package pads and set_part_fields.
import { describe, expect, test } from "vitest"
import { patchRulesText } from "../src/core/rules-patch.js"
import { packagesText, PADS_LISTED_UP_TO } from "../src/core/packages.js"
import { padLines, PADS_SHOWN } from "../src/core/pad-lines.js"
import { PACKAGES } from "../src/engine/footprints/catalogue.js"
import { generateFootprint } from "../src/engine/footprints/index.js"
import { padRoles } from "../src/engine/footprints/pad-roles.js"
import { USB_C16_CONTACTS } from "../src/engine/footprints/usb.js"
import { boardInputProblem, offBoardLine } from "../src/mcp/board-tool.js"
import { withFields } from "../src/library/part-fields.js"
import type { Part } from "../src/core/library.js"

describe("patchRulesText", () => {
  test("merges objects key by key, replaces other values and lists each change", () => {
    const { text, changes } = patchRulesText("fabrication:\n  minClearance: 0.15\n", { fabrication: { profile: "jlcpcb-4layer" }, globalNets: ["GND"] })
    expect(text).toContain("minClearance: 0.15")
    expect(text).toContain("profile: jlcpcb-4layer")
    expect(changes).toEqual(['fabrication.profile = "jlcpcb-4layer"', 'globalNets = ["GND"]'])
  })

  test("null removes a key, and the map it leaves empty", () => {
    expect(patchRulesText("fabrication:\n  minClearance: 0.15\n", { fabrication: { minClearance: null } })).toEqual({ text: "", changes: ["fabrication.minClearance removed"] })
  })

  test("a placement rotation for one library part goes under fabrication.placementRotations.parts", () => {
    expect(patchRulesText("", { fabrication: { placementRotations: { parts: { "AMS1117-3.3": 270 } } } }).text).toContain("AMS1117-3.3: 270")
  })

  test("refuses what a build would refuse, an empty patch, a reserved key, a broken file and no change", () => {
    expect(() => patchRulesText("", { fabrication: { minDrill: -1 } })).toThrow(/fabrication\.minDrill: "-1" is not a positive length/)
    expect(() => patchRulesText("", { netClasses: { default: { nets: ["A"] } } })).toThrow(/"default" is the class of every other net/)
    expect(() => patchRulesText("", {})).toThrow(/rules must be an object/)
    expect(() => patchRulesText("", JSON.parse('{"__proto__": {}}'))).toThrow(/cannot be a key/)
    expect(() => patchRulesText("a: [", { globalNets: ["GND"] })).toThrow(/cannot be read/)
    expect(() => patchRulesText("globalNets:\n  - GND\n", { globalNets: ["GND"] })).toThrow(/already says that/)
  })

  test("a reserved key is refused however deep, whether its parent exists or not", () => {
    const patch = JSON.parse('{"netClasses": {"__proto__": {"nets": ["A"]}}}')
    expect(() => patchRulesText("", patch)).toThrow(/cannot be a key/)
    expect(() => patchRulesText("netClasses:\n  p:\n    nets: [B]\n", patch)).toThrow(/cannot be a key/)
  })

  test("each echoed value is capped, and a file that is a list is refused in plain words", () => {
    const nets = Array.from({ length: 2000 }, (_, i) => `N${i}`)
    const { changes } = patchRulesText("", { globalNets: nets })
    expect(changes[0]?.length).toBeLessThan(230)
    expect(changes[0]).toMatch(/…$/)
    expect(() => patchRulesText("- a\n- b\n", { fabrication: { minDrill: 0.3 } })).toThrow("rules.yaml is not a map of settings (key: value); it was not changed")
  })
})

describe("pad roles", () => {
  test("every role names a pad of the footprint and every pad of a package with roles has one", () => {
    const withRoles = PACKAGES.filter((entry) => padRoles(entry) !== undefined)
    expect(withRoles.map((entry) => entry.footprint)).toEqual(expect.arrayContaining(["dcjack", "usb_b", "usb_c16", "tact6x6", "tact6x6_smd", "sod123", "sma", "do41", "led3528", "led5mm", "tant_a", "smdcan4x5.4", "radial5x2"]))
    for (const entry of withRoles) {
      const footprint = generateFootprint(entry.footprint)
      if ("error" in footprint) throw new Error(footprint.error)
      expect(Object.keys(padRoles(entry) ?? {}).sort(), entry.footprint).toEqual([...new Set(footprint.pads.map((pad) => pad.number))].sort())
    }
  })

  test("the Type-C pads carry the contacts usb.ts names, in its order", () => {
    const roles = padRoles({ footprint: "usb_c16", group: "Connectors" }) ?? {}
    USB_C16_CONTACTS.forEach((contact, i) => expect(roles[String(i + 1)]).toMatch(new RegExp(`^${contact} `)))
    expect(roles["5"]).toBe("B7 D−")
  })

  test("packages with no documented roles get none", () => {
    expect(padRoles({ footprint: "soic8", group: "ICs with leads" })).toBeUndefined()
    expect(padRoles({ footprint: "led5050", group: "LEDs" })).toBeUndefined()
  })

  test("a search lists pads only when it finds a few packages", () => {
    expect(packagesText(["usb_c16"]).text).toContain("usb_c16 pads")
    expect(packagesText(["soic"]).text).not.toContain(" pads:")
    expect(PADS_LISTED_UP_TO).toBe(3)
  })

  test("pad lines are capped", () => {
    const pad = { number: "1", shape: "rect" as const, x: 0, y: 0, width: 1, height: 1, rotation: 0, layers: "top" as const }
    const lines = padLines(Array.from({ length: PADS_SHOWN + 5 }, () => pad))
    expect(lines).toHaveLength(PADS_SHOWN + 1)
    expect(lines.at(-1)).toBe("  … and 5 more pads")
  })
})

describe("fit_board arguments", () => {
  test("only arguments that go together pass", () => {
    expect(boardInputProblem({ file: "a", width: 10, height: 5, x: 1 })).toBeUndefined()
    expect(boardInputProblem({ file: "a", height: 5 })).toMatch(/together/)
    expect(boardInputProblem({ file: "a", y: 5 })).toMatch(/centre/)
  })

  test("the off-board line names the parts", () => {
    expect(offBoardLine([])).toEqual([])
    expect(offBoardLine(["J1"])).toEqual(["1 placed part is now outside the board: J1; move it inside or make the board larger"])
  })
})

describe("withFields", () => {
  const part: Part = { title: "x", footprint: "0402", pins: { "1": { name: "A", type: "passive" } }, suppliers: { lcsc: "C1" }, mpn: "M", verified: { by: "Ada", against: "p1", date: "2026-11-18" } }

  test("changes only the given fields, merges suppliers and drops the verification", () => {
    const { part: next, changes } = withFields(part, { suppliers: { jlcpcb: "C2" }, mpn: null, description: "a resistor" })
    expect(next).toEqual({ title: "x", footprint: "0402", pins: part.pins, suppliers: { lcsc: "C1", jlcpcb: "C2" }, description: "a resistor" })
    expect(changes).toEqual(["mpn removed", 'description "a resistor"', "jlcpcb C2"])
    expect(part.suppliers).toEqual({ lcsc: "C1" })
  })

  test("a value equal to the current one is no change", () => {
    expect(withFields(part, { mpn: "M", suppliers: { lcsc: "C1" } }).changes).toEqual([])
  })
})
