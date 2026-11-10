import { readFileSync } from "node:fs"
import { expect, test } from "vitest"
import { generateFootprint } from "../../src/engine/footprints/index.js"

const docs = readFileSync(new URL("../../docs/footprints.md", import.meta.url), "utf8")
const skill = readFileSync(new URL("../../skills/copperflow/references/editable-subset.md", import.meta.url), "utf8")

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

test("every generated family has a drawing", () => {
  for (const heading of ["QFN and QFP", "DFN", "BGA", "SOD and DO-214", "SOT-223 and SOT-89", "DIP", "TO-220 and TO-92", "HC-49", "Radial", "Two-row"]) {
    expect(docs).toMatch(new RegExp(`### ${heading}[^\\n]*\\n[\\s\\S]*?\`\`\`\\n`))
  }
})
