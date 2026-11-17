import { cp, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { buildBom } from "../src/core/bom.js"
import { formatOrderReport, orderReportLines } from "../src/core/order-report.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const EXAMPLES = join(import.meta.dirname, "..", "examples")
let root: string

beforeEach(async () => {
  // The real path: on Windows the temp folder can be an 8.3 short name, and the program compares real paths.
  root = await realpath(await mkdtemp(join(tmpdir(), "cf-order-")))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function report(file: string, options: { short?: boolean } = {}) {
  const design = await inProcessEngine.build(root, file)
  const bom = await buildBom(root, file, { design })
  return formatOrderReport(design, bom, options)
}

const board = (body: string) => `export default () => (\n  <board width="10mm" height="10mm">\n${body}\n  </board>\n)\n`
const NUMBERED = '    <resistor name="R1" resistance="1k" footprint="0402" supplierPartNumbers={{ jlcpcb: ["C11702"] }} pcbX={0} pcbY={0} schX={0} schY={0} />'

const CAN_NODE = [
  "Order report for can-node.circuit.tsx",
  "Board: 28.2 x 26.8 mm, 2 layers. Checks: 0 errors, 0 unrouted connections, no warnings.",
  "Ready for bare boards: yes",
  "BOM: 11 lines, 0 with a supplier part number. Without one:",
  "  C101, C102: capacitor 27pF 0603",
  "  C103, C104, C105: capacitor 100nF 0603",
  "  J1: pinheader pinrow7_p2.54mm",
  "  J2: pinheader pinrow1_p2.54mm",
  "  J3: pinheader pinrow3_p2.54mm",
  "  JP1: pinheader pinrow2_p2.54mm",
  "  R101: resistor 10k 0603",
  "  R102: resistor 120 0805",
  "  U101: chip MCP2515 stand-alone CAN controller with SPI, SOIC-18 wide soic18w",
  "  U102: chip TJA1051T/3 high-speed CAN transceiver with VIO, SO8 soic8",
  "  Y101: crystal 8MHz hc49",
  "Not verified: MCP2515-I-SO (U101), TJA1051T-3 (U102). A person should check them against their datasheets before ordering.",
  "Through-hole: J1, J2, J3, JP1, Y101",
  "Ready for assembly: no: 11 of 11 lines have no supplier part number; 2 library parts are not verified",
  'Add a number to a built-in part: set_props { part, props: { supplierPartNumbers: "jlcpcb:<number>" } } in the file that writes it (a sheet\'s part by its name in the .sheet.tsx).',
  'Add a number to a library part: suppliers: { jlcpcb: "<number>" } in parts/<id>/part.yaml, then copperflow parts build (or create_part again with replace); a person then verifies it again.',
  "No price or stock is checked: copperflow stores neither.",
  '"Ready" covers only the lines above: it does not say the board works or that a maker will accept it.',
]

describe("the order report", () => {
  test("can-node is ready for bare boards and not for assembly, line by line", async () => {
    await cp(join(EXAMPLES, "can-node"), root, { recursive: true })
    expect(await report("can-node.circuit.tsx")).toBe(CAN_NODE.join("\n"))
  })

  test("the short form is the two verdicts and where the rest is", async () => {
    await cp(join(EXAMPLES, "can-node"), root, { recursive: true })
    expect(await report("can-node.circuit.tsx", { short: true })).toBe(
      [
        "Ready for bare boards: yes",
        "Ready for assembly: no: 11 of 11 lines have no supplier part number; 2 library parts are not verified",
        "The whole order report: the bom tool, or copperflow bom can-node.circuit.tsx.",
      ].join("\n"),
    )
  })

  test("a board where every line has a number is ready", async () => {
    await writeFile(join(root, "one.circuit.tsx"), board(NUMBERED))
    const text = await report("one.circuit.tsx")
    expect(text).toContain("BOM: 1 line, 1 with a supplier part number.\n")
    expect(text).toContain("Ready for bare boards: yes\n")
    expect(text).toContain("Ready for assembly: yes\n")
    expect(text).toContain("Through-hole: none\n")
    expect(text).not.toContain("Not verified")
  })

  test("a board with an unrouted connection is not ready for bare boards", async () => {
    const body = `${NUMBERED}\n    <resistor name="R2" resistance="1k" footprint="0402" supplierPartNumbers={{ jlcpcb: ["C11702"] }} pcbX={3} pcbY={0} schX={3} schY={0} />\n    <trace from="R1.pin2" to="R2.pin1" />`
    await writeFile(join(root, "two.circuit.tsx"), board(body))
    const text = await report("two.circuit.tsx")
    expect(text).toMatch(/Checks: 0 errors, 1 unrouted connection, /)
    expect(text).toContain("Ready for bare boards: no: 1 unrouted connection\n")
  })

  test("a board with an error is not ready for bare boards, and says the check's count", async () => {
    await writeFile(join(root, "bad.circuit.tsx"), board(`${NUMBERED}\n    <resistor name="R2" resistance="1k" footprint="bogus9" pcbX={3} pcbY={0} schX={3} schY={0} />`))
    const text = await report("bad.circuit.tsx")
    expect(text).toMatch(/Checks: [1-9]\d* errors?, /)
    expect(text).toMatch(/Ready for bare boards: no: [1-9]\d* errors?/)
  })

  test("a board without an outline is not ready for bare boards", async () => {
    await writeFile(join(root, "open.circuit.tsx"), `export default () => (\n  <board>\n${NUMBERED}\n  </board>\n)\n`)
    const text = await report("open.circuit.tsx")
    expect(text).toContain("Board: no outline")
    expect(text).toMatch(/Ready for bare boards: no: .*no board outline/)
  })

  test("never more than 40 lines: the missing numbers are cut with a count", async () => {
    const parts = Array.from({ length: 60 }, (_, i) => `    <resistor name="R${i + 1}" resistance="${i + 1}k" footprint="0402" pcbX={${(i % 8) - 4}} pcbY={${Math.floor(i / 8) - 4}} />`)
    await writeFile(join(root, "many.circuit.tsx"), `export default () => (\n  <board width="30mm" height="30mm">\n${parts.join("\n")}\n  </board>\n)\n`)
    const lines = (await report("many.circuit.tsx")).split("\n")
    expect(lines.length).toBe(40)
    expect(lines).toContain("BOM: 60 lines, 0 with a supplier part number. Without one:")
    expect(lines.find((line) => line.startsWith("  … and "))).toMatch(/^ {2}… and \d+ more$/)
    expect(lines.at(-1)).toBe(CAN_NODE.at(-1))
  })

  test("a line without a value says its MPN: io-8's diodes", async () => {
    await cp(join(EXAMPLES, "io-8"), root, { recursive: true })
    expect((await report("io-8.circuit.tsx")).split("\n")).toContain("  D101, D201, D301, D401, D501, D601, D701, D801: diode BZT52C3V6-7-F sod123")
  })

  test("the lines are plain strings, deterministic", async () => {
    await cp(join(EXAMPLES, "can-node"), root, { recursive: true })
    const design = await inProcessEngine.build(root, "can-node.circuit.tsx")
    const bom = await buildBom(root, "can-node.circuit.tsx", { design })
    expect(orderReportLines(design, bom)).toEqual(orderReportLines(design, bom))
  })
})
