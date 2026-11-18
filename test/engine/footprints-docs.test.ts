import { readFileSync } from "node:fs"
import { expect, test } from "vitest"
import { generateFootprint } from "../../src/engine/footprints/index.js"

const docs = readFileSync(new URL("../../docs/footprints.md", import.meta.url), "utf8")
const skill = readFileSync(new URL("../../skills/copperflow/references/editable-subset.md", import.meta.url), "utf8")

/** Strings of the later families that the docs' table and the skill's table both write out. */
const LATER_STRINGS = [
  "01005", "2220", "array4x0603", "array4x0402", "array2x0402", "sod123f", "sod523", "sod923", "sod128", "minimelf", "melf", "sod80", "do213aa", "do213ab",
  "sot23_8", "sot143", "sot323", "sc70", "sot353", "sc70_5", "sot363", "sc70_6", "sot523", "sot563", "sot723", "dpak", "to252", "d2pak", "to263", "d2pak_5", "d2pak_7",
  "tant_a", "tant3216", "tant3528", "tant6032", "tant7343", "msop8", "msop10", "to220_2", "to220_5", "to247", "to126",
  "do35", "do41", "do15", "do201ad", "led3mm", "led5mm", "led3528", "led5050", "led5050_6", "hc49smd", "xtal2016", "xtal2520", "xtal3225", "xtal5032", "xtal5032_2", "xtal3215", "xtal7050",
  "smdcan4x5.4", "smdcan5x5.4", "smdcan6.3x5.4", "smdcan6.3x7.7", "smdcan8x6.5", "smdcan8x10.2", "smdcan10x10.2",
]

/** The second cell of each row of the "Strings" table: one example string per family. */
function examples(): string[] {
  const table = docs.slice(docs.indexOf("## Strings"), docs.indexOf("## The families"))
  return table
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Family") && !line.startsWith("| ---"))
    .map((line) => /`([^`]+)`/.exec(line.split("|")[2] ?? "")?.[1] ?? "")
}

test("every example string in docs/footprints.md makes a footprint", () => {
  const strings = examples()
  expect(strings.length).toBeGreaterThanOrEqual(16)
  for (const text of strings) expect(generateFootprint(text), text).not.toHaveProperty("error")
})

test("the examples in the skill's footprint table make footprints", () => {
  for (const text of ["lqfp64_10x10_p0.5", "qfn32_5x5_p0.5_ep3.1", "dfn8_3x3_p0.65_ep1.6x2.4", "bga256_17x17_p1", "dip28_w15.24", "radial6.3x2.5"]) {
    expect(skill).toContain(`\`${text}\``)
    expect(generateFootprint(text), text).not.toHaveProperty("error")
  }
})

test("every later family has a section, and the strings table names every new family", () => {
  const section = docs.slice(docs.indexOf("## Families added later"))
  for (const heading of ["Chips 01005 and 2220, SOD and MELF", "Small SOTs and SOT-23-8", "DPAK and D2PAK", "Tantalum capacitors", "MSOP, QSOP and an exposed pad on dual packages", "Resistor arrays", "PLCC and SMD DIP", "More TO packages", "Axial parts and diodes", "LEDs", "Screw terminals, pin sockets and SMD cans", "Surface-mount crystals"]) {
    expect(section, heading).toContain(`### ${heading}`)
  }
  const table = docs.slice(docs.indexOf("## Strings"), docs.indexOf("## The families"))
  for (const text of LATER_STRINGS) expect(table, text).toContain(`\`${text}\``)
})

test("the strings the skill's table names for the later families make footprints", () => {
  for (const text of LATER_STRINGS) {
    expect(skill, text).toContain(`\`${text}\``)
    expect(generateFootprint(text), text).not.toHaveProperty("error")
  }
  // the forms written as patterns in the skill's table: one example of each makes a footprint
  for (const [pattern, text] of [["`qsop<N>`", "qsop20"], ["`plcc<N>`", "plcc28"], ["`smdip<N>`", "smdip8"], ["`socket<N>`", "socket4"], ["`screw<N>`", "screw3"], ["`axial<body length>x<lead spacing>`", "axial6.3x10.16"]] as const) {
    expect(skill, pattern).toContain(pattern)
    expect(generateFootprint(text), text).not.toHaveProperty("error")
  }
  expect(skill).toContain("to92_inline")
  expect(generateFootprint("to92_inline")).toHaveProperty("error")
  // the examples of strings that cannot be made must still be refused
  for (const text of ["sot666", "to3"]) {
    expect(skill).toContain(`\`${text}\``)
    expect(generateFootprint(text), text).toHaveProperty("error")
  }
})

test("every generated family has a drawing", () => {
  for (const heading of ["QFN and QFP", "DFN", "BGA", "SOD and DO-214", "SOT-223 and SOT-89", "DIP", "TO-220 and TO-92", "HC-49", "Radial", "Two-row"]) {
    expect(docs).toMatch(new RegExp(`### ${heading}[^\\n]*\\n[\\s\\S]*?\`\`\`\\n`))
  }
})
