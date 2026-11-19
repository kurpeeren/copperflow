import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { findPackages, PACKAGE_FORMS, PACKAGE_GROUPS, PACKAGES, packageFacts } from "../../src/engine/footprints/catalogue.js"
import { generateFootprint } from "../../src/engine/footprints/index.js"

const padsOf = (text: string) => {
  const result = generateFootprint(text)
  if ("error" in result) throw new Error(result.error)
  return result.pads
}

/** One probe string per family module of index.ts; each must be a string the catalogue lists. */
const PROBES: Readonly<Record<string, string>> = {
  array: "array4x0603",
  axial: "axial6.3x10.16",
  bga: "bga256_17x17_p1",
  chip: "0603",
  crystal: "hc49s",
  dfn: "dfn8_3x3_p0.65",
  dip: "dip8",
  dpak: "dpak",
  dual: "soic8",
  ledsmd: "led5050",
  ledth: "led5mm",
  melf: "melf",
  molded: "sma",
  pinrow: "pinrow2x5",
  plcc: "plcc44",
  quad: "lqfp64_10x10_p0.5",
  radial: "radial6.3x2.5",
  trimmer: "trimmer3296w",
  wirepad: "wirepad2_d1",
  screw: "screw2",
  smallsot: "sot323",
  smdcan: "smdcan8x10.2",
  smdip: "smdip8",
  socket: "socket8",
  sod: "sod123",
  sot: "sot23_5",
  sotpower: "sot223",
  tantalum: "tant_b",
  to220: "to220",
  to92: "to92",
  to92inline: "to92",
  topower: "to247",
  xtal: "xtal3225",
  resonator: "resonator3213",
  usb: "usb_b",
  dcjack: "dcjack",
  tact: "tact6x6",
  inductor: "ind4x4",
}

/** Modules imported by index.ts that make no footprint string of their own. */
const NOT_FAMILIES = new Set(["file", "known", "parse", "types"])

describe("the catalogue's strings", () => {
  test("every string generates a footprint", () => {
    const refused = PACKAGES.flatMap((entry) => {
      const result = generateFootprint(entry.footprint)
      return "error" in result ? [`${entry.footprint}: ${result.error}`] : []
    })
    expect(refused).toEqual([])
  })

  test("no string is listed twice, and none is another entry's other name", () => {
    const strings = PACKAGES.flatMap((entry) => [entry.footprint, ...(entry.also ?? [])])
    const twice = strings.filter((text, i) => strings.indexOf(text) !== i)
    expect(twice).toEqual([])
  })

  test("every other string gives the same pads as its entry", () => {
    for (const entry of PACKAGES) {
      for (const other of entry.also ?? []) {
        expect(padsOf(other), `${other} for ${entry.footprint}`).toEqual(padsOf(entry.footprint))
      }
    }
  })

  test("a metric chip code finds its imperial size by the name, and is never an accepted string", () => {
    expect(findPackages(["1608"]).map((entry) => entry.footprint)).toContain("0603")
    expect(generateFootprint("1608")).toHaveProperty("error")
    for (const entry of PACKAGES) expect(entry.also ?? [], entry.footprint).not.toContain("1608")
  })

  test("every entry's group is one of the groups, and every group has packages", () => {
    expect(PACKAGES.filter((entry) => !PACKAGE_GROUPS.includes(entry.group))).toEqual([])
    for (const group of PACKAGE_GROUPS) expect(PACKAGES.some((entry) => entry.group === group), group).toBe(true)
  })

  test("packages follow the order of the groups", () => {
    const order = PACKAGES.map((entry) => PACKAGE_GROUPS.indexOf(entry.group))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  test("every entry has a name and no entry is written in capitals or with spaces in its string", () => {
    for (const entry of PACKAGES) {
      expect(entry.name.length, entry.footprint).toBeGreaterThan(2)
      expect(entry.footprint, entry.footprint).toMatch(/^[a-z0-9_.]+$/)
    }
  })
})

describe("the families", () => {
  test("every family module imported by index.ts has a probe", () => {
    const source = readFileSync(new URL("../../src/engine/footprints/index.ts", import.meta.url), "utf8")
    const modules = [...source.matchAll(/from "\.\/(\w+)\.js"/g)].map((found) => found[1] as string).filter((name) => !NOT_FAMILIES.has(name))
    expect(Object.keys(PROBES).sort()).toEqual([...new Set(modules)].sort())
  })

  test("every probe is listed in the catalogue", () => {
    const listed = new Set(PACKAGES.map((entry) => entry.footprint))
    expect(Object.values(PROBES).filter((probe) => !listed.has(probe))).toEqual([])
  })

  test("the general forms are written once each and none is empty", () => {
    const forms = PACKAGE_FORMS.map((one) => one.form)
    expect(new Set(forms).size).toBe(forms.length)
    for (const one of PACKAGE_FORMS) expect(one.says.length).toBeGreaterThan(5)
  })
})

describe("extras", () => {
  test("extras are marked true, the first sizes of each numbered family are not, and findPackages([]) still has both", () => {
    const extras = PACKAGES.filter((entry) => entry.extra !== undefined)
    expect(extras.every((entry) => entry.extra === true)).toBe(true)
    expect(extras.length).toBeGreaterThan(40)
    expect(PACKAGES.length - extras.length).toBeGreaterThan(100)
    expect(findPackages([])).toHaveLength(PACKAGES.length)
    const listed = new Set(extras.map((entry) => entry.footprint))
    for (const text of ["qfn24_4x4_p0.5", "qfn56_8x8_p0.5", "lqfp176_24x24_p0.5", "tssop28", "dip40_w15.24".replace("40", "32"), "pinrow2x17", "socket2x20", "screw6_p3.5", "bga144_13x13_p1"]) {
      expect(listed.has(text), text).toBe(true)
    }
    expect(listed.has("soic8")).toBe(false)
  })

  test("a search finds an extra", () => {
    expect(findPackages(["qfn", "40"]).map((entry) => entry.footprint)).toContain("qfn40_6x6_p0.5")
  })
})

describe("packageFacts", () => {
  const entry = (footprint: string) => PACKAGES.find((one) => one.footprint === footprint) ?? expect.fail(`${footprint} is not listed`)

  test("a SOIC-8 has 8 pads and is surface-mount", () => {
    const facts = packageFacts(entry("soic8"))
    expect(facts.pads).toBe(8)
    expect(facts.mount).toBe("surface-mount")
    expect(facts.width).toBeGreaterThan(5)
    expect(facts.height).toBeGreaterThan(4)
    expect(facts.origin).toMatch(/IPC-7351B/)
  })

  test("a DIP-8 has 8 pads and is through-hole", () => {
    const facts = packageFacts(entry("dip8"))
    expect(facts.pads).toBe(8)
    expect(facts.mount).toBe("through-hole")
  })

  test("pads are distinct pad numbers: a SOT-89 counts its tab with pin 2", () => {
    expect(packageFacts(entry("sot89")).pads).toBe(3)
  })

  test("the size is the courtyard, and agrees with the footprint", () => {
    const result = generateFootprint("0603")
    if ("error" in result) throw new Error(result.error)
    const xs = result.courtyard.map((point) => point.x)
    const facts = packageFacts(entry("0603"))
    expect(facts.width).toBeCloseTo(Math.max(...xs) - Math.min(...xs), 1)
  })

  test("an entry that cannot be made says which", () => {
    expect(() => packageFacts({ footprint: "nonsense9", name: "x", group: "Diodes" })).toThrow(/nonsense9/)
  })
})

describe("findPackages", () => {
  test("no words gives everything, in catalogue order", () => {
    expect(findPackages([])).toEqual(PACKAGES)
  })

  test("every word has to match: sot and 5", () => {
    const found = findPackages(["sot", "5"]).map((one) => one.footprint)
    expect(found).toContain("sot23_5")
    expect(found).toContain("sot353")
    expect(found).not.toContain("sot23")
    expect(found.every((text) => /sot|5/.test(text))).toBe(true)
  })

  test("another name finds the entry: sc70 finds sot323", () => {
    expect(findPackages(["sc70"]).map((one) => one.footprint)).toContain("sot323")
    expect(findPackages(["do214ac"]).map((one) => one.footprint)).toEqual(["sma"])
    expect(findPackages(["to252"]).map((one) => one.footprint)).toEqual(["dpak"])
  })

  test("a written name with dashes and capitals finds the string", () => {
    expect(findPackages(["SOT-23-5"]).map((one) => one.footprint)).toContain("sot23_5")
  })

  test("a group name finds its packages", () => {
    const found = findPackages(["crystals"])
    expect(found.length).toBeGreaterThan(5)
    expect(found.every((one) => one.group === "Crystals and oscillators")).toBe(true)
  })

  test("words that match nothing give nothing", () => {
    expect(findPackages(["zzzz"])).toEqual([])
  })
})
