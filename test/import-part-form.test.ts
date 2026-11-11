import { describe, expect, test } from "vitest"
import { importSummary, LCSC_HINT, originLabel, readImportRequest, verifyHint, type ImportPartResult } from "../studio/src/shell/import-part-form.js"

const RESULT: ImportPartResult = {
  id: "XH2",
  lcsc: "C158012",
  title: "B2B-XH-A (LF)(SN), CONN-TH_B2B-XH-A-LF-SN",
  pins: 2,
  pads: 2,
  files: ["parts/XH2/part.yaml"],
  notes: [],
  terms: "…",
}

describe("Import by LCSC number dialog", () => {
  test("reads the number in any case, an optional id and the replace choice", () => {
    expect(readImportRequest(" c7950 ", "", false)).toEqual({ lcsc: "C7950", replace: false })
    expect(readImportRequest("C7950", " OPAMP ", true)).toEqual({ lcsc: "C7950", id: "OPAMP", replace: true })
  })

  test("an empty field asks for the number; anything else says what one looks like", () => {
    expect(readImportRequest("  ", "", false)).toEqual({ message: LCSC_HINT })
    expect(readImportRequest("7950", "", false)).toEqual({ message: '"7950" is not an LCSC part number: it looks like C7950 (C and digits).' })
    expect(readImportRequest("C0", "", false)).toHaveProperty("message")
  })

  test("the result's lines", () => {
    expect(importSummary(RESULT)).toBe("Imported C158012 as XH2: B2B-XH-A (LF)(SN), CONN-TH_B2B-XH-A-LF-SN, 2 pins, 2 pads.")
    expect(importSummary({ ...RESULT, pins: 1, pads: 1 })).toContain("1 pin, 1 pad.")
    expect(verifyHint(RESULT)).toContain("parts/XH2/verification.md")
  })

  test("the Library shows where an imported part came from", () => {
    expect(originLabel("lcsc C7950, imported 2026-11-11")).toBe("Imported from LCSC C7950 on 2026-11-11")
    expect(originLabel("from a friend")).toBe("from a friend")
    expect(originLabel(undefined)).toBeUndefined()
  })
})
