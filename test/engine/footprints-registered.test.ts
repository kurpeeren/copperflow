import { describe, expect, test } from "vitest"
import { generateFootprint, padCount } from "../../src/engine/footprints/index.js"
import { KNOWN_FORMS, nearestFootprints, unknownFootprint } from "../../src/engine/footprints/known.js"
import { FOOTPRINT_FAMILIES, PLACEMENT_ROTATIONS, footprintFamily } from "../../src/engine/rules/rotations.js"

/** One example per form the generator added after the first families, with the family it must have. */
const NEW_FORMS: Readonly<Record<string, string>> = {
  "01005": "chip",
  "2220": "chip",
  sod523: "sod",
  sod923: "sod",
  sod123f: "sod",
  sod128: "sod",
  sod80: "sod",
  minimelf: "sod",
  melf: "sod",
  do213aa: "sod",
  do213ab: "sod",
  sot323: "sot",
  sc70: "sot",
  sot353: "sot",
  sc70_5: "sot",
  sot363: "sot",
  sc70_6: "sot",
  sot523: "sot",
  sot563: "sot",
  sot723: "sot",
  sot143: "sot",
  sot23_8: "sot",
  tant_a: "tant",
  tant_b: "tant",
  tant_c: "tant",
  tant_d: "tant",
  tant_e: "tant",
  tant3216: "tant",
  tant3528: "tant",
  tant6032: "tant",
  tant7343: "tant",
  msop8: "msop",
  msop10: "msop",
  qsop16: "qsop",
  qsop20: "qsop",
  qsop24: "qsop",
  qsop28: "qsop",
  "soic8_ep2.3x2.3": "soic",
  "msop8_ep1.7x1.9": "msop",
  "msop10_ep1.7x1.9": "msop",
  "tssop20_ep3x4.2": "tssop",
  array4x0603: "array",
  array4x0402: "array",
  array2x0402: "array",
  dpak: "dpak",
  to252: "dpak",
  d2pak: "d2pak",
  to263: "d2pak",
  d2pak_5: "d2pak",
  to263_5: "d2pak",
  d2pak_7: "d2pak",
  to263_7: "d2pak",
  to247: "to247",
  to126: "to126",
  to220_2: "to220",
  to220_5: "to220",
  plcc20: "plcc",
  plcc28: "plcc",
  plcc32: "plcc",
  plcc44: "plcc",
  plcc52: "plcc",
  plcc68: "plcc",
  plcc84: "plcc",
  smdip4: "smdip",
  smdip6: "smdip",
  smdip8: "smdip",
  smdip16: "smdip",
  axial10x15: "axial",
  "axial10x15_d2.5": "axial",
  do35: "axial",
  do41: "axial",
  do15: "axial",
  do201ad: "axial",
  led3mm: "ledth",
  led5mm: "ledth",
  led3528: "ledsmd",
  led5050: "ledsmd",
  led5050_6: "ledsmd",
  screw2: "screw",
  "screw24_p3.81": "screw",
  socket8: "socket",
  socket2x5: "socket2x",
  "smdcan4x5.4": "smdcan",
  "smdcan5x5.4": "smdcan",
  "smdcan6.3x5.4": "smdcan",
  "smdcan6.3x7.7": "smdcan",
  "smdcan8x6.5": "smdcan",
  "smdcan8x10.2": "smdcan",
  "smdcan10x10.2": "smdcan",
  xtal2016: "xtal",
  xtal2520: "xtal",
  xtal3225: "xtal",
  xtal5032: "xtal",
  xtal5032_2: "xtal",
  xtal3215: "xtal",
  xtal7050: "xtal",
  hc49smd: "hc49smd",
  resonator3213: "resonator",
  usb_b: "usb",
  usb_c16: "usb",
  dcjack: "dcjack",
  "dcjack2.1": "dcjack",
  tact6x6: "tact",
  tact6x6_smd: "tact",
  ind4x4: "ind",
  ind12x12: "ind",
}

describe("the new strings are registered", () => {
  test.each(Object.keys(NEW_FORMS))("%s makes a footprint with pads", (text) => {
    const result = generateFootprint(text)
    expect(result, text).not.toHaveProperty("error")
    expect(padCount(text), text).toBeGreaterThanOrEqual(2)
  })

  test("a bare _ep on a dual package says why, and a size makes it", () => {
    for (const text of ["soic8_ep", "msop8_ep", "msop10_ep", "tssop20_ep"]) {
      expect(generateFootprint(text)).toEqual({ error: expect.stringContaining("_ep needs the exposed pad's size") })
    }
  })

  test("to92_inline is refused with its reason, and the forms line does not offer it", () => {
    expect(generateFootprint("to92_inline")).toEqual({ error: expect.stringContaining("use to92, the leads formed to 2.54 mm") })
    expect(KNOWN_FORMS).not.toContain("to92_inline")
    expect(nearestFootprints("to93")).not.toContain("to92_inline")
  })

  test("the tab of a DPAK and a D2PAK is pad 2", () => {
    for (const text of ["dpak", "d2pak"]) {
      const result = generateFootprint(text)
      if ("error" in result) throw new Error(result.error)
      expect(result.pads.map((pad) => pad.number).sort()).toEqual(["1", "2", "3"])
      // the tab is the wide pad, on the other side of the leads
      const tab = result.pads.find((pad) => pad.number === "2")
      const lead = result.pads.find((pad) => pad.number === "1")
      expect(tab?.width).toBeGreaterThan((lead?.width ?? 0) * 2)
      expect(Math.sign(tab?.y ?? 0)).toBe(-Math.sign(lead?.y ?? 0))
    }
  })
})

describe("every new string has a pick-and-place family", () => {
  test.each(Object.entries(NEW_FORMS))("%s is %s", (text, family) => {
    expect(footprintFamily(text)).toBe(family)
    expect(FOOTPRINT_FAMILIES).toContain(family)
    expect(footprintFamily(text)).not.toBeUndefined()
  })

  test("MSOP and QSOP take the TSSOP and SSOP correction, small SOTs and MELF their siblings'", () => {
    expect(PLACEMENT_ROTATIONS.msop).toBe(PLACEMENT_ROTATIONS.tssop)
    expect(PLACEMENT_ROTATIONS.qsop).toBe(PLACEMENT_ROTATIONS.ssop)
    expect(PLACEMENT_ROTATIONS[footprintFamily("sot323") ?? "chip"]).toBe(PLACEMENT_ROTATIONS.sot)
    expect(PLACEMENT_ROTATIONS[footprintFamily("melf") ?? "chip"]).toBe(PLACEMENT_ROTATIONS.sod)
  })

  test("every other new family is 0, as the rule for corrections that are not well established says", () => {
    const established = new Set(["sot", "sot223", "soic", "sop", "ssop", "tssop", "msop", "qsop"])
    for (const family of FOOTPRINT_FAMILIES) {
      if (!established.has(family)) expect(PLACEMENT_ROTATIONS[family], family).toBe(0)
    }
  })

  test("the table has exactly the families the list names", () => {
    expect(Object.keys(PLACEMENT_ROTATIONS).sort()).toEqual([...FOOTPRINT_FAMILIES].sort())
  })
})

describe("the refusal names the new forms", () => {
  test("every form that is a fixed string is in the forms line", () => {
    const words = new Set(KNOWN_FORMS.split(/[\s,;()]+/))
    // a name may be written as its pattern ("soic<N>") or as an alias in the forms line; the fixed strings that
    // are written out must all be there
    for (const text of ["01005", "2220", "sod523", "sod923", "sod123f", "sod128", "minimelf", "melf", "sot323", "sot353", "sot363", "sc70", "sc70_5", "sc70_6", "sot523", "sot563", "sot723", "sot143", "sot23_8", "tant3216", "tant3528", "tant6032", "tant7343", "array4x0603", "array4x0402", "array2x0402", "dpak", "d2pak", "d2pak_5", "d2pak_7", "to252", "to263", "to263_5", "to263_7", "to247", "to126", "to220_2", "to220_5", "do35", "do41", "do15", "do201ad", "led3mm", "led5mm", "led3528", "led5050", "led5050_6", "xtal2016", "xtal2520", "xtal3225", "xtal5032", "xtal5032_2", "xtal3215", "xtal7050", "hc49smd", "sod80", "do213aa", "do213ab", "resonator3213", "usb_b", "usb_c16", "dcjack", "dcjack2.1", "dcjack2.5", "tact6x6", "tact6x6_smd"]) {
      expect(words.has(text), text).toBe(true)
    }
    for (const pattern of ["msop<N> (N 8, 10)", "qsop<N> (N 16, 20, 24, 28)", "plcc<N> (N 20, 28, 32, 44, 52, 68, 84)", "smdip<N> (N 4, 6, 8, 16)", "tant_a … tant_e", "axial<length>x<spacing>[_d<diameter>]", "smdcan<can>x<height>", "socket<N>", "socket2x<N>", "screw<N>[_p3.5|3.81|5|5.08] (N 2–24)", "soic8_ep<w>x<h>", "tssop<N>_ep<w>x<h>", "ind<a>x<a> (4x4 5x5 6x6 8x8 10x10 12x12)"]) {
      expect(KNOWN_FORMS, pattern).toContain(pattern)
    }
    expect(KNOWN_FORMS).not.toContain("\n")
    // the series named by a pin-count line appear once each
    expect(KNOWN_FORMS.split("msop<N>").length - 1).toBe(1)
  })
})

describe("the nearest strings for the new kinds", () => {
  test("a misspelled small SOT names the SOT beside it", () => {
    expect(nearestFootprints("sot324")).toContain("sot323")
    expect(nearestFootprints("sot324")[0]).toBe("sot323")
  })

  test("a PLCC pin count between two sizes names both", () => {
    expect(nearestFootprints("plcc30")).toEqual(expect.arrayContaining(["plcc28", "plcc32"]))
  })

  test("a crystal size one digit off names the real one", () => {
    expect(nearestFootprints("xtal3226")).toContain("xtal3225")
  })

  test("a tantalum case letter beyond E names the cases before it, never a size", () => {
    expect(nearestFootprints("tant_f")).toEqual(["tant_c", "tant_d", "tant_e"])
    expect(nearestFootprints("tant3217")).toEqual(["tant3216", "tant3528", "tant6032"])
  })

  test("a can that is not in the table names the nearest cans by diameter and height", () => {
    const near = nearestFootprints("smdcan6.3x6")
    expect(near).toContain("smdcan6.3x5.4")
    expect(near).toContain("smdcan6.3x7.7")
  })

  test("D2PAK with a wrong number is near the D2PAK, a TO number near the TO packages", () => {
    expect(nearestFootprints("d3pak")).toEqual(["d2pak"])
    expect(nearestFootprints("to248")).toContain("to247")
  })

  test("MSOP and QSOP counts, array sizes and LED sizes", () => {
    expect(nearestFootprints("msop9")).toEqual(["msop8", "msop10"])
    expect(nearestFootprints("qsop18")).toEqual(["qsop16", "qsop20", "qsop24"])
    expect(nearestFootprints("array4x0604")).toContain("array4x0603")
    expect(nearestFootprints("led4mm")).toContain("led3mm")
  })

  test("an inductor size not in the table names the nearest sizes", () => {
    expect(nearestFootprints("ind7x7")).toEqual(["ind5x5", "ind6x6", "ind8x8"])
  })

  test("a string of a kind without neighbours names none, and every string suggested builds a footprint", () => {
    expect(nearestFootprints("xyz")).toEqual([])
    for (const text of ["sot324", "plcc30", "xtal3226", "tant_f", "tant3217", "smdcan6.3x6", "d3pak", "to248", "msop9", "qsop18", "array4x0604", "led4mm", "sod999", "socket41", "screw25", "do200", "smdip5", "xtal7051", "ind7x7", "tact5x5", "dcjack3"]) {
      for (const near of nearestFootprints(text)) expect(generateFootprint(near), `${near} (near ${text})`).not.toHaveProperty("error")
    }
  })

  test("the refusal of a string no family takes carries them", () => {
    expect(unknownFootprint("xtal3226")).toMatch(/^copperflow cannot make footprint "xtal3226": nearest are .*xtal3225.*; known families are /)
  })
})
