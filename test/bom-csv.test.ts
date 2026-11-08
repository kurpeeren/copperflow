import { describe, expect, test } from "vitest"
import type { BomLine } from "../studio/src/api.js"
import { bomCsv, bomFileName } from "../studio/src/shell/bom-csv.js"

const line = (extra: Partial<BomLine> = {}): BomLine => ({
  designators: ["R1", "R2"],
  quantity: 2,
  kind: "resistor",
  value: "5.1k",
  footprint: "0402",
  manufacturer: "",
  mpn: "",
  supplier: "LCSC C25905",
  datasheet: "",
  ...extra,
})

describe("bomCsv", () => {
  test("writes a header and one row per line, ending each with CRLF", () => {
    expect(bomCsv([line()])).toBe(
      "Designators,Quantity,Value,Footprint,Manufacturer,MPN,Supplier part,Verified\r\nR1 R2,2,5.1k,0402,,,LCSC C25905,\r\n",
    )
  })

  test("uses the kind when there is no value, and marks library parts verified or not", () => {
    const csv = bomCsv([line({ value: "", libraryPart: "ap2112", verified: false }), line({ libraryPart: "x", verified: true })])
    expect(csv.split("\r\n")[1]).toBe("R1 R2,2,resistor,0402,,,LCSC C25905,no")
    expect(csv.split("\r\n")[2]?.endsWith(",yes")).toBe(true)
  })

  test("quotes fields with commas, quotes or line breaks", () => {
    expect(bomCsv([line({ value: 'a,"b"\nc' })]).split("\r\n")[1]).toBe('R1 R2,2,"a,""b""\nc",0402,,,LCSC C25905,')
  })
})

describe("bomFileName", () => {
  test("takes the circuit file's base name", () => {
    expect(bomFileName("boards/usb.circuit.tsx")).toBe("usb-bom.csv")
    expect(bomFileName("index.tsx")).toBe("index-bom.csv")
  })
})
