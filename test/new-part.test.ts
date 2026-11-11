// The part wizard's writer, shared by create_part and Library → New part…: part.yaml written by a person or the agent
// from a datasheet, through the core, unverified, with origin "written".
import { beforeEach, describe, expect, test } from "vitest"
import { access, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse } from "yaml"
import { listParts, readPart, rebuildComponents } from "../src/core/library.js"
import { formatNewPart, stubFootprint, writeNewPart, type NewPartInput } from "../src/library/new-part.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const NOW = "2026-11-11T09:30:00.000Z"
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-new-part-"))
})

const CRYSTAL: NewPartInput = {
  id: "X16M",
  title: "16 MHz crystal, HC-49/S",
  manufacturer: "Abracon",
  mpn: "ABLS-16.000MHZ-B4-T",
  package: "hc49s",
  pins: "Pin Name Type\n1 XTAL1 passive\n2 XTAL2 passive",
  suppliers: { lcsc: "C16212" },
  datasheet: { url: "https://abracon.com/Resonators/abls.pdf" },
}

describe("writing a part from the wizard", () => {
  test("writes part.yaml with origin written, the component and verification.md; the part is unverified", async () => {
    const result = await writeNewPart(root, CRYSTAL, { now: NOW })
    expect(result.files).toEqual(["parts/X16M/part.yaml", "parts/X16M/X16M.tsx", "parts/X16M/verification.md"])
    expect(result.verification).toBe("parts/X16M/verification.md")
    const yaml = parse(await readFile(join(root, "parts", "X16M", "part.yaml"), "utf8"))
    expect(yaml).toEqual({
      title: "16 MHz crystal, HC-49/S",
      manufacturer: "Abracon",
      mpn: "ABLS-16.000MHZ-B4-T",
      origin: "written 2026-11-11",
      footprint: "hc49s",
      pins: { "1": { name: "XTAL1", type: "passive" }, "2": { name: "XTAL2", type: "passive" } },
      suppliers: { lcsc: "C16212" },
      datasheet: { url: "https://abracon.com/Resonators/abls.pdf" },
    })
    expect(result.checklist).toContain("Status: not verified")
    expect(result.checklist).toContain("- [ ] Pin 1 is XTAL1 (passive)")
    expect(result.checklist).not.toContain("nothing from the source has been checked")
    expect(await readFile(join(root, "parts", "X16M", "verification.md"), "utf8")).toBe(result.checklist)
    expect(await listParts(root)).toEqual([expect.objectContaining({ id: "X16M", verified: false, origin: "written 2026-11-11" })])
    expect(await readFile(join(root, "parts", "X16M", "part.yaml"), "utf8")).not.toContain("\r")
  })

  test("pins may be rows or a record as well as a pasted table", async () => {
    await writeNewPart(root, { ...CRYSTAL, id: "XA", pins: [{ number: "1", name: "A", type: "passive" }, { number: "2", name: "B", type: "passive", description: "the other leg" }] }, { now: NOW })
    expect((await readPart(root, "XA")).pins["2"]).toEqual({ name: "B", type: "passive", description: "the other leg" })
    await writeNewPart(root, { ...CRYSTAL, id: "XB", pins: { "1": { name: "A", type: "passive" }, "2": { name: "B", type: "passive" } } }, { now: NOW })
    expect(Object.keys((await readPart(root, "XB")).pins)).toEqual(["1", "2"])
  })

  test("an existing id is refused unless replace; a verified part is never replaced", async () => {
    await writeNewPart(root, CRYSTAL, { now: NOW })
    await expect(writeNewPart(root, { ...CRYSTAL, title: "Another" }, { now: NOW })).rejects.toThrow("Part X16M already exists; pass replace to overwrite it")
    expect((await readPart(root, "X16M")).title).toBe("16 MHz crystal, HC-49/S")
    await writeNewPart(root, { ...CRYSTAL, title: "Another" }, { now: NOW, replace: true })
    expect((await readPart(root, "X16M")).title).toBe("Another")
  })

  test("what is wrong comes back as one message and nothing is written", async () => {
    await expect(writeNewPart(root, { ...CRYSTAL, pins: "1 XTAL1 P\n2 XTAL2 passive\n2 X passive" }, { now: NOW })).rejects.toThrow(
      'The pin table has problems: Line 1: "P" is not a pin type; use power_in, power_out, ground, input, output, bidirectional, passive or no_connect; Line 3: pin 2 is already on line 2',
    )
    await expect(writeNewPart(root, { ...CRYSTAL, pins: "" }, { now: NOW })).rejects.toThrow("The part has no pins")
    await expect(writeNewPart(root, { ...CRYSTAL, package: "qfn5_9x9" }, { now: NOW })).rejects.toThrow('Package "qfn5_9x9": copperflow cannot make footprint')
    await expect(writeNewPart(root, { ...CRYSTAL, package: "soic8" }, { now: NOW })).rejects.toThrow('Package "soic8" does not fit the pins: pad 3 is not a pin in part.yaml')
    await expect(writeNewPart(root, { ...CRYSTAL, package: "footprint.yaml" }, { now: NOW })).rejects.toThrow(
      'Package "footprint.yaml" is not a footprint string: for the part\'s own footprint file pass package { "file": "footprint.yaml" }',
    )
    await expect(writeNewPart(root, { ...CRYSTAL, pins: "1 XTAL1\n2 XTAL2\n3 CASE ground" }, { now: NOW })).rejects.toThrow("pin 3 (CASE) has no pad")
    await expect(writeNewPart(root, { ...CRYSTAL, id: "../x" }, { now: NOW })).rejects.toThrow("is not a valid part id")
    await expect(writeNewPart(root, { ...CRYSTAL, datasheet: { url: "ftp://x" } }, { now: NOW })).rejects.toThrow("datasheet.url")
    expect(await readdir(join(root, "parts")).catch(() => [])).toEqual([])
  })

  test("footprint file: a placeholder footprint.yaml, one pad per pin in a row, noted as to be completed", async () => {
    const result = await writeNewPart(root, { ...CRYSTAL, id: "CONN3", package: { file: "footprint.yaml" }, pins: "1 A passive\n2 B passive\n3 C no_connect" }, { now: NOW })
    expect(result.files).toEqual(["parts/CONN3/part.yaml", "parts/CONN3/footprint.yaml", "parts/CONN3/CONN3.tsx", "parts/CONN3/verification.md"])
    expect(result.notes).toEqual([expect.stringContaining("footprint.yaml is a placeholder")])
    expect(result.checklist).toContain("## Notes\n\n- [ ] footprint.yaml is a placeholder")
    const file = parse(await readFile(join(root, "parts", "CONN3", "footprint.yaml"), "utf8"))
    expect(file.pads.map((pad: { number: string; x: number }) => [pad.number, pad.x])).toEqual([
      ["1", -2.54],
      ["2", 0],
      ["3", 2.54],
    ])
    expect((await readPart(root, "CONN3")).footprint).toBe("footprint.yaml")
  })

  test("a wide SOIC or SSOP part's checklist asks for the pads to be compared with the datasheet; a narrow SOIC's does not", async () => {
    const pins = Array.from({ length: 16 }, (_, i) => `${i + 1} P${i + 1} passive`).join("\n")
    const note = "Compare the pads with the land pattern in the maker's datasheet; this package's outline was not taken from the drawing."
    for (const [id, pkg] of [["WIDE", "soic16w"], ["SHRINK", "ssop16"]] as const) {
      const result = await writeNewPart(root, { ...CRYSTAL, id, package: pkg, pins }, { now: NOW })
      expect(result.notes).toEqual([note])
      expect(result.checklist).toContain(`- [ ] ${note}`)
    }
    expect((await writeNewPart(root, { ...CRYSTAL, id: "NARROW", package: "soic16", pins }, { now: NOW })).notes).toEqual([])
  })

  test("the placeholder for more than four pins is a dual in-line outline: 2.54 mm pitch, rows 7.62 mm apart", () => {
    const pins = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), { name: `P${i + 1}`, type: "passive" as const }]))
    const at = (n: number) => stubFootprint(pins(n)).pads.map((pad) => [pad.number, pad.x, pad.y])
    expect(at(4).map(([, , y]) => y)).toEqual([0, 0, 0, 0])
    expect(at(6)).toEqual([
      ["1", -3.81, 2.54],
      ["2", -3.81, 0],
      ["3", -3.81, -2.54],
      ["4", 3.81, -2.54],
      ["5", 3.81, 0],
      ["6", 3.81, 2.54],
    ])
    // Odd counts put the extra pin in the first row; the second row starts at the bottom.
    expect(at(5)).toEqual([
      ["1", -3.81, 2.54],
      ["2", -3.81, 0],
      ["3", -3.81, -2.54],
      ["4", 3.81, -2.54],
      ["5", 3.81, 0],
    ])
    const eighteen = stubFootprint(pins(18))
    expect(eighteen.placeholder).toBe(true)
    const ys = eighteen.pads.map((pad) => pad.y)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(8 * 2.54, 9)
    expect(new Set(eighteen.pads.map((pad) => pad.x))).toEqual(new Set([-3.81, 3.81]))
    expect(eighteen.pads.every((pad) => pad.width > pad.height && pad.height < 2.54)).toBe(true)
  })

  test("footprint file with the pads given (create_part's footprint_file) writes them, without the placeholder note", async () => {
    const { placeholder, ...pads } = stubFootprint({ "1": { name: "A", type: "passive" }, "2": { name: "B", type: "passive" } })
    expect(placeholder).toBe(true)
    const result = await writeNewPart(root, { ...CRYSTAL, id: "TWO", package: { file: "footprint.yaml" }, footprintFile: { ...pads, pads: pads.pads.map((pad) => ({ ...pad, width: 0.7 })) } }, { now: NOW })
    expect(result.notes).toEqual([])
    expect(await readFile(join(root, "parts", "TWO", "footprint.yaml"), "utf8")).toContain("width: 0.7")
    await expect(writeNewPart(root, { ...CRYSTAL, id: "BAD", footprintFile: pads }, { now: NOW })).rejects.toThrow('pads are given only with package { file: "footprint.yaml" }')
  })

  test("parts build accepts the part and it builds in a circuit with the generator's pads", async () => {
    await writeNewPart(root, CRYSTAL, { now: NOW })
    await writeNewPart(root, { ...CRYSTAL, id: "J3", title: "3-pin connector", package: { file: "footprint.yaml" }, pins: "1 A passive\n2 B passive\n3 C passive" }, { now: NOW })
    expect(await rebuildComponents(root)).toEqual(["parts/J3/J3.tsx", "parts/X16M/X16M.tsx"])
    await writeFile(
      join(root, "main.circuit.tsx"),
      [
        'import { X16M } from "./parts/X16M/X16M"',
        'import { J3 } from "./parts/J3/J3"',
        "export default () => (",
        '  <board width="30mm" height="20mm">',
        '    <X16M name="Y1" pcbX={-6} pcbY={0} />',
        '    <J3 name="J1" pcbX={8} pcbY={0} />',
        '    <trace from="Y1.pin1" to="J1.pin1" />',
        "  </board>",
        ")",
        "",
      ].join("\n"),
    )
    const design = await inProcessEngine.build(root, "main.circuit.tsx")
    const pads = (name: string) => design.pcb.parts.find((part) => part.component === name)?.pads ?? []
    expect(pads("Y1").map((pad) => pad.layers)).toEqual(["through", "through"])
    expect(pads("J1")).toHaveLength(3)
  })

  test("the answer is compact: what was written, and that it is not verified", async () => {
    const result = await writeNewPart(root, CRYSTAL, { now: NOW })
    expect(formatNewPart(result)).toBe(
      [
        "Created X16M: 16 MHz crystal, HC-49/S, 2 pins, footprint hc49s.",
        "Wrote parts/X16M/part.yaml, parts/X16M/X16M.tsx, parts/X16M/verification.md.",
        "It is NOT verified: check every pin and the footprint in parts/X16M/verification.md against the datasheet.",
      ].join("\n"),
    )
    await access(join(root, "parts", "X16M", "X16M.tsx"))
  })
})
