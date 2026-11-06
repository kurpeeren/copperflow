import { beforeEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildBom, exportPackage, formatBomCsv, formatBomMarkdown } from "../src/core/bom.js"
import { createPart, verifyPart } from "../src/core/library.js"
import { LDO, USBX, USBX_FOOTPRINT } from "./fixtures.js"
import { inProcessEngine as engine } from "./helpers/in-process-engine.js"

const FILE = "boards/main.circuit.tsx"
const SOURCE = `import { LDO } from "../parts/LDO/LDO"

export default () => (
  <board width="10mm" height="10mm">
    <resistor name="R10" resistance="1k" footprint="0402" />
    <resistor name="R2" resistance="5.1k" footprint="0402" supplierPartNumbers={{ jlcpcb: ["C25905"] }} />
    <resistor name="R1" resistance="5.1k" footprint="0402" supplierPartNumbers={{ jlcpcb: ["C25905"] }} />
    <LDO name="U1" />
    <group name="G1">
      <led name="D1" color="red" footprint="0603" />
    </group>
  </board>
)
`
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
    const lines = await buildBom(root, FILE, { engine })
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

  test("parts made in a .map() loop appear, one line for equal parts", async () => {
    await writeFile(
      join(root, FILE),
      `export default () => (
  <board width="10mm" height="10mm">
    {["R1", "R2"].map((n) => (
      <resistor name={n} resistance="1k" footprint="0402" />
    ))}
  </board>
)
`,
    )
    const lines = await buildBom(root, FILE, { engine })
    expect(lines.map((l) => [l.designators, l.quantity, l.value])).toEqual([[["R1", "R2"], 2, "1k"]])
  })

  test("supplierPartNumbers written in the code give the supplier column", async () => {
    await writeFile(
      join(root, FILE),
      `export default () => (
  <board width="10mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0402" supplierPartNumbers={{ jlcpcb: ["C25905"] }} />
  </board>
)
`,
    )
    const [line] = await buildBom(root, FILE, { engine })
    expect(line?.supplier).toBe("jlcpcb C25905")
  })

  test("a part with a footprint the engine cannot make still has a line", async () => {
    await writeFile(
      join(root, FILE),
      `export default () => (
  <board width="10mm" height="10mm">
    <led name="D1" color="red" footprint="bga64" />
  </board>
)
`,
    )
    const lines = await buildBom(root, FILE, { engine })
    expect(lines.map((l) => [l.designators, l.footprint])).toEqual([[["D1"], "bga64"]])
  })

  describe("an instance that overrides what its verified library part owns", () => {
    const withLdo = (instance: string) => writeFile(join(root, FILE), SOURCE.replace('<LDO name="U1" />', instance))
    const ldoLine = async () => (await buildBom(root, FILE, { engine })).find((l) => l.libraryPart === "LDO")

    beforeEach(() => verifyPart(root, "LDO", { by: "Eren", against: "datasheet p.2" }, "t"))

    test("a footprint and an MPN of its own make the line not verified, and the design warns", async () => {
      await withLdo('<LDO name="U1" footprint="0603" manufacturerPartNumber="OTHER" />')
      expect(await ldoLine()).toMatchObject({ verified: false, footprint: "0603", mpn: "OTHER" })
      const warnings = (await engine.build(root, FILE)).diagnostics.filter((d) => d.code === "library-override")
      expect(warnings).toMatchObject([{ severity: "warning", items: ["U1.footprint", "U1.manufacturerPartNumber"] }])
      expect(warnings[0]?.message).toContain("LDO")
    })

    test("supplier numbers of its own are enough", async () => {
      await withLdo('<LDO name="U1" supplierPartNumbers={{ jlcpcb: ["C1"] }} />')
      expect(await ldoLine()).toMatchObject({ verified: false, supplier: "jlcpcb C1" })
    })

    test("the library's own values, written again, keep it verified", async () => {
      await withLdo('<LDO name="U1" footprint="sot23_5" manufacturerPartNumber="AP2112K-3.3TRG1" supplierPartNumbers={{ jlcpcb: ["C51118"] }} />')
      expect((await ldoLine())?.verified).toBe(true)
    })
  })

  test("a verified part with a footprint file is verified in the BOM until an instance overrides its footprint", async () => {
    await createPart(root, "USBX", USBX, { footprintFile: USBX_FOOTPRINT, now: "t" })
    await verifyPart(root, "USBX", { by: "Eren", against: "drawing p.1" }, "t")
    const circuit = (instance: string) =>
      `import { USBX } from "../parts/USBX/USBX"\nexport default () => (\n  <board width="20mm" height="20mm">\n    ${instance}\n  </board>\n)\n`
    await writeFile(join(root, FILE), circuit('<USBX name="J1" />'))
    expect((await buildBom(root, FILE, { engine }))[0]).toMatchObject({ libraryPart: "USBX", verified: true })
    await writeFile(join(root, FILE), circuit('<USBX name="J1" footprint="0603" />'))
    expect((await buildBom(root, FILE, { engine }))[0]).toMatchObject({ libraryPart: "USBX", verified: false })
  })

  test("a library part is verified only after a person verifies it", async () => {
    const before = await buildBom(root, FILE, { engine })
    expect(before.find((l) => l.libraryPart === "LDO")?.verified).toBe(false)
    await verifyPart(root, "LDO", { by: "Eren", against: "datasheet p.2" }, "t")
    const after = await buildBom(root, FILE, { engine })
    expect(after.find((l) => l.libraryPart === "LDO")?.verified).toBe(true)
  })

  test("a given design is used without building", async () => {
    const design = await engine.build(root, FILE)
    const lines = await buildBom(root, FILE, { design })
    expect(lines.map((l) => l.designators.join(" "))).toEqual(["D1", "R1 R2", "R10", "U1"])
  })

  test("a circuit-code error reaches the caller as file:line:column", async () => {
    await writeFile(join(root, FILE), "export default () => <board>\n")
    await expect(buildBom(root, FILE, { engine })).rejects.toThrow(/boards\/main\.circuit\.tsx:\d+:\d+: .*/)
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
    const result = await exportPackage(root, FILE, { engine })
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
    await expect(exportPackage(root, FILE, { outDir: "../out", engine })).rejects.toThrow(/outside the project/)
  })
})
