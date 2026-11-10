import { describe, expect, test } from "vitest"
import type { BomLine } from "../../src/core/bom.js"
import { jlcpcbBomCsv } from "../../src/engine/fab/bom-csv.js"

const line = (extra: Partial<BomLine> = {}): BomLine => ({
  designators: ["R1", "R2"],
  quantity: 2,
  kind: "resistor",
  value: "10k",
  footprint: "0805",
  manufacturer: "",
  mpn: "",
  supplier: "jlcpcb C17414",
  datasheet: "",
  ...extra,
})

describe("the JLCPCB bill of materials", () => {
  test("one row per BOM line in JLCPCB's columns, the designators in one quoted field, LF line ends", () => {
    const csv = jlcpcbBomCsv([line(), line({ designators: ["U1"], quantity: 1, kind: "chip", value: "MCP2515", footprint: "parts/MCP2515/footprint.yaml", supplier: "LCSC C9657" })])
    expect(csv).toBe(['Comment,Designator,Footprint,LCSC Part #', '10k,"R1,R2",0805,C17414', "MCP2515,U1,MCP2515,C9657", ""].join("\n"))
  })

  test("the comment falls back to the MPN, then the kind; a part from another supplier has no LCSC number", () => {
    const csv = jlcpcbBomCsv([line({ value: "", mpn: "TJA1050T", supplier: "digikey 568-1" }), line({ value: "", designators: ["J1"], kind: "pinheader", supplier: "" })])
    expect(csv.split("\n").slice(1, 3)).toEqual(['TJA1050T,"R1,R2",0805,', "pinheader,J1,0805,"])
  })

  test("the footprint is the part's id for a library part drawn with its footprint file, else the footprint string", () => {
    const rows = jlcpcbBomCsv([
      line({ designators: ["U1"], value: "MCP2515", footprint: "parts/MCP2515/footprint.yaml", libraryPart: "MCP2515" }),
      line({ designators: ["U2"], value: "TJA1050", footprint: "soic8", libraryPart: "TJA1050" }),
      line({ designators: ["X1"], value: "x", footprint: "boards/x.footprint.yaml" }),
    ])
    expect(rows.split("\n").slice(1, 4).map((row) => row.split(",")[2])).toEqual(["MCP2515", "soic8", "boards/x.footprint.yaml"])
  })

  test("a value a spreadsheet would run as a formula is written as text, and quotes are doubled", () => {
    expect(jlcpcbBomCsv([line({ value: '=1+1 "x"' })]).split("\n")[1]).toBe(`"'=1+1 ""x""","R1,R2",0805,C17414`)
  })
})
