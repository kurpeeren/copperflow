import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { ENGINE_FILES } from "../../src/engine/engine.js"
import type { Net } from "../../src/engine/model.js"
import { collectProjectFiles } from "../../src/engine/project-files.js"
import { classOfNet, netClasses, requiredClearance } from "../../src/engine/rules/classes.js"
import { loadRules } from "../../src/engine/rules/load.js"
import { DEFAULT_CLASS, PROFILES } from "../../src/engine/rules/profiles.js"
import { BOARD } from "../fixtures.js"

const load = (yaml: string) => loadRules({ "rules.yaml": yaml })
const named = (...names: string[]): Net => ({ id: `net.${names[0]}`, names, pins: [] })
const unnamed: Net = { id: "net:R1.pin1", names: [], pins: ["R1.pin1"] }

describe("loadRules", () => {
  test("without a file it uses the default profile and no classes", () => {
    const { rules, diagnostics } = loadRules({})
    expect(rules.fabrication.name).toBe("jlcpcb-2layer")
    expect(rules.classes).toEqual([])
    expect(rules.file).toBeUndefined()
    expect(diagnostics).toEqual([])
  })

  test("every built-in profile names its source with a date", () => {
    for (const [key, profile] of Object.entries(PROFILES)) {
      expect(profile.name).toBe(key)
      expect(profile.source).toMatch(/jlcpcb\.com\/capabilities\/pcb-capabilities/)
      expect(profile.source).toMatch(/\d{4}-\d{2}-\d{2}/)
    }
  })

  test("a profile choice and a length with units override the profile", () => {
    const { rules, diagnostics } = load("fabrication:\n  profile: jlcpcb-4layer\n  minClearance: 6mil\n")
    expect(diagnostics).toEqual([])
    expect(rules.fabrication.copperLayers).toBe(4)
    expect(rules.fabrication.minClearance).toBeCloseTo(0.1524, 6)
    expect(rules.fabrication.minDrill).toBe(PROFILES["jlcpcb-4layer"]?.minDrill)
    expect(rules.file).toBe("rules.yaml")
  })

  test("a class field left out takes the default class value", () => {
    const { rules } = load("netClasses:\n  power:\n    trackWidth: 0.5\n    nets: [GND]\n")
    expect(rules.classes[0]).toEqual({ ...DEFAULT_CLASS, name: "power", trackWidth: 0.5, patterns: ["GND"] })
    expect(rules.classes[0]?.clearance).toBe(0.2)
  })

  test("a class can set only the via diameter", () => {
    const { rules } = load("netClasses:\n  power:\n    via: { diameter: 1 }\n    nets: [GND]\n")
    expect(rules.classes[0]?.via).toEqual({ drill: DEFAULT_CLASS.via.drill, diameter: 1 })
  })

  test("reads class clearances and global nets", () => {
    const { rules, diagnostics } = load(
      "netClasses:\n  field:\n    nets: [V24]\nclassClearance:\n  - [field, default, 2.5]\nglobalNets: [GND, V24]\n",
    )
    expect(diagnostics).toEqual([])
    expect(rules.classClearance).toEqual([{ a: "field", b: "default", clearance: 2.5 }])
    expect(rules.globalNets).toEqual(["GND", "V24"])
  })

  test("a YAML syntax error gives one rules error with file and line, and the defaults", () => {
    const { rules, diagnostics } = load("fabrication:\n  profile: [oops\n")
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ code: "rules", severity: "error" })
    expect(diagnostics[0]?.message).toMatch(/rules\.yaml:\d+/)
    expect(rules.classes).toEqual([])
    expect(rules.fabrication.name).toBe("jlcpcb-2layer")
  })

  test("an unknown key is a rules error naming the key and its line", () => {
    const { rules, diagnostics } = load("fabrication:\n  minClearence: 0.2\n")
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ code: "rules", severity: "error" })
    expect(diagnostics[0]?.message).toContain("minClearence")
    expect(diagnostics[0]?.message).toContain("rules.yaml:2")
    expect(rules.fabrication.minClearance).toBe(PROFILES["jlcpcb-2layer"]?.minClearance)
  })

  test("an unknown profile, a bad length and a class named default are errors", () => {
    for (const yaml of ["fabrication: { profile: pcbway }\n", "fabrication: { minDrill: lots }\n", "netClasses:\n  default:\n    nets: [A]\n"]) {
      const { diagnostics } = load(yaml)
      expect([yaml, diagnostics.map((d) => d.code)]).toEqual([yaml, ["rules"]])
    }
  })

  test("a class clearance that names an unknown class is an error", () => {
    const { diagnostics } = load("classClearance:\n  - [ghost, default, 2]\n")
    expect(diagnostics.map((d) => d.code)).toEqual(["rules"])
    expect(diagnostics[0]?.message).toContain("ghost")
  })

  test("an unquoted pattern that starts with * is a rules error at the alias's line, and the defaults apply", () => {
    const { rules, diagnostics } = load("netClasses:\n  power:\n    nets: [*GND]\n")
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ code: "rules", severity: "error", items: ["rules.yaml"], source: { file: "rules.yaml", line: 3 } })
    expect(diagnostics[0]?.message).toMatch(/^rules\.yaml:3: /)
    expect(diagnostics[0]?.message).toContain('"*GND"')
    expect(rules.classes).toEqual([])
    expect(rules.fabrication.name).toBe("jlcpcb-2layer")
  })

  test("an alias bomb is one rules error, not a hang or a throw", () => {
    const names = "abcdefghij".split("")
    const lines = names.map((name, i) => `${name}: &${name} [${Array.from({ length: 9 }, () => (i === 0 ? "x" : `*${names[i - 1]}`)).join(", ")}]`)
    const started = Date.now()
    const { rules, diagnostics } = load(`${lines.join("\n")}\n`)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ code: "rules", severity: "error", source: { line: 2 } })
    expect(rules.classes).toEqual([])
  })

  test("an empty file is the defaults", () => {
    const { rules, diagnostics } = load("# nothing yet\n")
    expect(diagnostics).toEqual([])
    expect(rules.fabrication.name).toBe("jlcpcb-2layer")
  })
})

describe("net classes", () => {
  const rules = load(
    "netClasses:\n  power:\n    nets: [GND, 'V*']\n  field:\n    nets: ['IN?', V24]\n  other:\n    nets: [GND]\nclassClearance:\n  - [field, default, 2.5]\n",
  ).rules

  test("classOfNet matches names with * and ?, and falls back to default", () => {
    expect(classOfNet(rules, named("V3_3"))).toBe("power")
    expect(classOfNet(rules, named("IN1"))).toBe("field")
    expect(classOfNet(rules, named("IN10"))).toBe("default")
    expect(classOfNet(rules, named("sig"))).toBe("default")
    expect(classOfNet(rules, named("v3_3"))).toBe("default")
  })

  test("a net matches by any of its names", () => {
    expect(classOfNet(rules, named("alias", "IN2"))).toBe("field")
  })

  test("an unnamed net belongs to no class unless a pattern is *", () => {
    expect(classOfNet(rules, unnamed)).toBe("default")
    const everything = load("netClasses:\n  all:\n    nets: ['*']\n").rules
    expect(classOfNet(everything, unnamed)).toBe("all")
    expect(classOfNet(everything, named("X"))).toBe("all")
  })

  test("two classes on one net give one net-class-conflict error, and the first class wins", () => {
    const { byNet, diagnostics } = netClasses(rules, [named("GND"), named("sig")])
    const conflicts = diagnostics.filter((d) => d.code === "net-class-conflict")
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ severity: "error", items: ["net.GND"] })
    expect(conflicts[0]?.message).toContain("power")
    expect(conflicts[0]?.message).toContain("other")
    expect(byNet.get("net.GND")).toBe("power")
    expect(byNet.get("net.sig")).toBe("default")
  })

  test("a pattern that matches no net is a rules warning", () => {
    const { diagnostics } = netClasses(rules, [named("GND"), named("V3_3")])
    const warnings = diagnostics.filter((d) => d.code === "rules")
    expect(warnings.map((d) => d.severity)).toEqual(["warning", "warning"])
    const text = warnings.map((d) => d.message).join("\n")
    expect(text).toContain("IN?")
    expect(text).toContain("V24")
  })

  test("requiredClearance is the largest of the classes, the pair entry and the profile minimum", () => {
    expect(requiredClearance(rules, "field", "default")).toBe(2.5)
    expect(requiredClearance(rules, "default", "field")).toBe(2.5)
    expect(requiredClearance(rules, "power", "power")).toBe(0.2)
    const loose = load("netClasses:\n  a:\n    clearance: 0.05\n    nets: [A]\nfabrication: { minClearance: 0.3 }\n").rules
    expect(requiredClearance(loose, "a", "a")).toBe(0.3)
  })
})

describe("rules in a build", () => {
  const files = {
    "main.circuit.tsx": BOARD,
    "shared.ts": "export const regulatorProps = { footprint: 'sot23_5', pinCount: 5 }; export const offset = 1",
    "rules.yaml": "netClasses:\n  ground:\n    trackWidth: 0.4\n    nets: [GND]\n",
  }

  test("buildDesign exposes the rules and keeps the design plain JSON", () => {
    const design = buildDesign(files, "main.circuit.tsx")
    expect(design.rules.classes.map((c) => c.name)).toEqual(["ground"])
    expect(design.diagnostics.filter((d) => d.code === "net-class-conflict")).toEqual([])
    expect(structuredClone(design)).toEqual(design)
  })

  test("a broken rules.yaml is a diagnostic, not a failed build", () => {
    const design = buildDesign({ ...files, "rules.yaml": "netClasses: [" }, "main.circuit.tsx")
    expect(design.diagnostics.some((d) => d.code === "rules" && d.severity === "error")).toBe(true)
    expect(design.rules.classes).toEqual([])
  })

  test("an unquoted * pattern does not stop the build", () => {
    const design = buildDesign({ ...files, "rules.yaml": "netClasses:\n  ground:\n    nets: [*GND]\n" }, "main.circuit.tsx")
    expect(design.diagnostics.filter((d) => d.code === "rules")).toEqual([expect.objectContaining({ severity: "error", source: expect.objectContaining({ line: 3 }) })])
    expect(design.rules.classes).toEqual([])
    expect(design.circuit.components.length).toBeGreaterThan(0)
  })

  test("the engine file pattern takes rules.yaml and footprint files", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-rules-"))
    await mkdir(join(root, "parts/J"), { recursive: true })
    await writeFile(join(root, "rules.yaml"), "globalNets: [GND]\n")
    await writeFile(join(root, "parts/J/footprint.yaml"), "pads: []\n")
    await writeFile(join(root, "parts/J/part.yaml"), "title: J\n")
    const collected = await collectProjectFiles(root, { include: ENGINE_FILES })
    expect(Object.keys(collected).sort()).toEqual(["parts/J/footprint.yaml", "rules.yaml"])
  })
})
