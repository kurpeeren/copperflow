import { beforeEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildBom, exportPackage, formatBomCsv, formatBomMarkdown } from "../src/core/bom.js"
import { createPart } from "../src/core/library.js"
import { LDO } from "./fixtures.js"

const FILE = "boards/main.circuit.tsx"
const SOURCE = `import { LDO } from "../parts/LDO/LDO"

export default () => (
  <board width="10mm" height="10mm">
    <resistor name="R10" resistance="1k" footprint="0402" />
    <resistor name="R2" resistance="5.1k" footprint="0402" />
    <resistor name="R1" resistance="5.1k" footprint="0402" />
    <LDO name="U1" />
    <group name="G1">
      <led name="D1" color="red" footprint="0603" />
    </group>
  </board>
)
`
const BUILD = [
  { type: "source_component", name: "R1", supplier_part_numbers: { jlcpcb: ["C25905"] } },
  { type: "source_component", name: "R2", supplier_part_numbers: { jlcpcb: ["C25905"] } },
]
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-bom-"))
  await mkdir(join(root, "boards"))
  await writeFile(join(root, FILE), SOURCE)
  await createPart(root, "LDO", { ...LDO, datasheet: { file: "ap2112.pdf", url: LDO.datasheet?.url } }, { now: "t" })
  await writeFile(join(root, "parts", "LDO", "ap2112.pdf"), "%PDF-1.4 test")
})

describe("buildBom", () => {
  test("groups equal parts, sorts designators naturally and fills library data", async () => {
    const lines = await buildBom(root, FILE, BUILD)
    expect(lines.map((l) => [l.designators.join(" "), l.quantity, l.value, l.footprint])).toEqual([
      ["D1", 1, "red", "0603"],
      ["R1 R2", 2, "5.1k", "0402"],
      ["R10", 1, "1k", "0402"],
      ["U1", 1, "AP2112K-3.3 LDO regulator", "sot23_5"],
    ])
    const ldo = lines.find((l) => l.designators[0] === "U1")
    expect(ldo).toMatchObject({ manufacturer: "Diodes Incorporated", mpn: "AP2112K-3.3TRG1", supplier: "jlcpcb C51118", libraryPart: "LDO", verified: false })
    expect(lines.find((l) => l.designators[0] === "R1")?.supplier).toBe("jlcpcb C25905")
  })
})

describe("formats", () => {
  test("CSV quotes separators and neutralises spreadsheet formulas", () => {
    const csv = formatBomCsv([
      { designators: ["R1"], quantity: 1, kind: "resistor", value: '=HYPERLINK("x")', footprint: "0402, thin", manufacturer: "", mpn: "", supplier: "", datasheet: "" },
    ])
    expect(csv.split("\n")[1]).toBe(`R1,1,resistor,"'=HYPERLINK(""x"")","0402, thin",,,,`)
  })

  test("Markdown escapes pipes", () => {
    const md = formatBomMarkdown([
      { designators: ["U1"], quantity: 1, kind: "chip", value: "a|b", footprint: "x", manufacturer: "", mpn: "", supplier: "", datasheet: "" },
    ])
    expect(md).toContain("| U1 | 1 | chip | a\\|b | x |")
  })
})

describe("exportPackage", () => {
  test("writes the BOM, copies local datasheets and lists verification status", async () => {
    const result = await exportPackage(root, FILE, { circuitJson: BUILD })
    expect(result.outDir).toBe("exports/boards/main")
    expect(result.files.sort()).toEqual([
      "exports/boards/main/BOM.csv",
      "exports/boards/main/BOM.md",
      "exports/boards/main/README.md",
      "exports/boards/main/datasheets/LDO.pdf",
    ])
    const readme = await readFile(join(root, "exports", "boards", "main", "README.md"), "utf8")
    expect(readme).toContain("| U1 | AP2112K-3.3 LDO regulator | not verified | [datasheet](datasheets/LDO.pdf) |")
    expect(await readFile(join(root, "exports", "boards", "main", "datasheets", "LDO.pdf"), "utf8")).toBe("%PDF-1.4 test")
  })

  test("refuses an output folder outside the project", async () => {
    await expect(exportPackage(root, FILE, { outDir: "../out" })).rejects.toThrow(/outside the project/)
  })
})
