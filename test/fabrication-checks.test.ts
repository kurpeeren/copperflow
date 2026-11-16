import { describe, expect, test } from "vitest"
import { checksLine, formatFabrication } from "../src/core/fabrication.js"
import { checkCounts } from "../src/core/check.js"

const written = (errors: number, warnings: number) => ({
  written: true as const,
  folder: "led-fab",
  zip: "led-fab.zip",
  files: ["led-F_Cu.gtl", "led-bom.csv", "led-pick-and-place.csv"],
  warnings: ["2 connections are not routed: a, b"],
  checks: { errors, warnings },
})

describe("the checks an export reports", () => {
  test("with errors, the line says to run the check and fix them before ordering", () => {
    expect(checksLine({ errors: 3, warnings: 2 })).toBe("Checks: 3 errors, 2 warnings. Run check_circuit (or copperflow check <file>) and fix the errors before anyone orders this board.")
  })

  test("without errors, only the counts", () => {
    expect(checksLine({ errors: 0, warnings: 2 })).toBe("Checks: 0 errors, 2 warnings.")
    expect(checksLine({ errors: 0, warnings: 1 })).toBe("Checks: 0 errors, 1 warning.")
  })

  test("formatFabrication puts the line after the warnings and before the next step", () => {
    const lines = formatFabrication(written(1, 0)).split("\n")
    expect(lines.at(-3)).toBe("Warning: 2 connections are not routed: a, b")
    expect(lines.at(-2)).toBe("Checks: 1 error, 0 warnings. Run check_circuit (or copperflow check <file>) and fix the errors before anyone orders this board.")
    expect(lines.at(-1)).toMatch(/^Next, a person should /)
  })

  test("the counts add up the findings of each group", () => {
    const group = (count: number) => ({ type: "x", count, messages: [] })
    expect(checkCounts({ errors: [group(2), group(1)], warnings: [group(4)] })).toEqual({ errors: 3, warnings: 4 })
  })
})
