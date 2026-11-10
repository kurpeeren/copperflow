import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { SHEET_DEFAULT_STEP as SHEET_GRID, gridLineSpacing, planGrid } from "../studio/src/pcb/grid.js"
import { darkSchematicTheme, schematicTheme, schematicThemeFor, setSheetPalette, sheetPalette, type SchematicPalette } from "../studio/src/pcb/schematic-theme.js"
import { contrastRatio } from "../studio/src/shell/contrast.js"

const SPEC = readFileSync(new URL("../docs/studio-easyeda-parity.md", import.meta.url), "utf8")
const START = SPEC.indexOf("**Schematic**")
const TABLE = SPEC.slice(START, SPEC.indexOf("**PCB**"))

/** The spec's row for an item, as its colours in the order they appear. */
function specColours(item: string): string[] {
  const row = TABLE.split("\n").find((line) => line.startsWith(`| ${item} |`))
  if (!row) throw new Error(`no spec row for ${item}`)
  return [...row.matchAll(/`(#[0-9A-Fa-f]{6})`/g)].map((m) => (m[1] as string).toUpperCase())
}

describe("schematicTheme", () => {
  test("the spec table is found", () => {
    expect(START).toBeGreaterThanOrEqual(0)
    expect(TABLE).toContain("| background |")
  })

  test("fixed values, whatever the doc says", () => {
    expect(schematicTheme).toMatchObject({
      background: "#FFFCF8", grid: "#F0F0EB", wire: "#008800", bus: "#008800", junction: "#CC0000", symbolOutline: "#A00000",
      pin: "#880000", pinName: "#000000", pinNumber: "#000000", designator: "#0000FF", netName: "#0000FF", value: "#000080",
      noConnect: "#33CC33", selection: "#FF0000", highlight: "#FF9933", border: "#A00000", titleText: "#000080",
    })
  })

  const rows: [string, (keyof typeof schematicTheme)[]][] = [
    ["background", ["background"]],
    ["grid", ["grid"]],
    ["wire, bus", ["wire", "bus"]],
    ["junction", ["junction"]],
    ["symbol outline", ["symbolOutline"]],
    ["pin", ["pin"]],
    ["pin name, pin number", ["pinName", "pinNumber"]],
    ["designator, net name", ["designator", "netName"]],
    ["value and other properties", ["value"]],
    ["no-connect flag", ["noConnect"]],
    ["selection", ["selection"]],
    ["highlight", ["highlight"]],
  ]
  test.each(rows)("%s matches the spec table", (item, keys) => {
    const [colour] = specColours(item)
    for (const key of keys) expect((schematicTheme[key] as string).toUpperCase()).toBe(colour)
  })

  test("the drawing border is the line colour and the title text the second colour", () => {
    const [lines, text] = specColours("drawing border, title block")
    expect(schematicTheme.border.toUpperCase()).toBe(lines)
    expect(schematicTheme.titleText.toUpperCase()).toBe(text)
  })

  test("the grid's dots are #D9D9D2, darker than its #F0F0EB lines (R20)", () => {
    expect(schematicTheme.gridDot).toBe("#D9D9D2")
    expect(schematicTheme.grid).toBe("#F0F0EB")
  })

  test("the sheet's CSS background is the same colour", () => {
    const css = readFileSync(new URL("../studio/src/styles.css", import.meta.url), "utf8")
    const theme = readFileSync(new URL("../studio/src/shell/theme.css", import.meta.url), "utf8")
    const block = css.slice(css.indexOf(".schematic-canvas {"))
    expect(block.slice(0, block.indexOf("}"))).toContain("background: var(--sheet-background)")
    expect(theme.toUpperCase()).toContain(`--SHEET-BACKGROUND: ${schematicTheme.background};`)
  })
})

describe("schematic grid", () => {
  test("a grid step of 3 device px or more gets a line each", () => {
    expect(gridLineSpacing(SHEET_GRID, 30)).toBe(SHEET_GRID)
    expect(gridLineSpacing(SHEET_GRID, 100)).toBe(SHEET_GRID)
    expect(gridLineSpacing(SHEET_GRID, 20, 1.5)).toBe(SHEET_GRID)
  })

  test("a closer step is stepped up by 5 until it is 3 device px apart", () => {
    expect(gridLineSpacing(SHEET_GRID, 29)).toBeCloseTo(0.5)
    expect(gridLineSpacing(SHEET_GRID, 6)).toBeCloseTo(0.5)
    expect(gridLineSpacing(SHEET_GRID, 5.9)).toBeCloseTo(2.5)
    expect(gridLineSpacing(SHEET_GRID, 1.2)).toBeCloseTo(2.5)
  })

  test("no grid when even 25 steps are under 3 device px", () => {
    expect(gridLineSpacing(SHEET_GRID, 1.19)).toBeNull()
    expect(planGrid({ cx: 0, cy: 0, scale: 0.5 }, { width: 800, height: 600 }, SHEET_GRID)).toBeNull()
  })

  test("lines cover the view at the chosen spacing", () => {
    const plan = planGrid({ cx: 0, cy: 0, scale: 100 }, { width: 200, height: 100 }, SHEET_GRID)
    const xs = (plan?.columns ?? []).map((i) => i * SHEET_GRID)
    const ys = plan?.rows ?? []
    expect(xs[0]).toBeLessThanOrEqual(-1)
    expect(xs[xs.length - 1]).toBeGreaterThanOrEqual(1)
    expect((xs[1] as number) - (xs[0] as number)).toBeCloseTo(SHEET_GRID)
    expect(ys.length).toBeGreaterThan(5)
  })
})

describe("the dark schematic palette", () => {
  test("a charcoal sheet, bright wires and a cyan selection; values ours, as the brief sets them", () => {
    expect(darkSchematicTheme).toMatchObject({
      background: "#141619", grid: "#2B3038", gridDot: "#2B3038", gridFifth: "#3A4049",
      symbolOutline: "#D9DEE5", pin: "#D9DEE5", wire: "#5BD3C7", bus: "#8AB4FF", junction: "#5BD3C7",
      netName: "#F2C66D", flag: "#FF9E80", designator: "#E6E8EB", value: "#AEB6C0", pinName: "#AEB6C0", pinNumber: "#7E8792",
      drawing: "#9AA1A9", selection: "#4CC9F0", hover: "#8BE0F5", markerError: "#FF6B6B", markerWarning: "#FFC857",
      border: "#9AA1A9", titleText: "#9AA1A9",
    })
  })

  test("only the dark selection glows: 8 device px in the selection colour", () => {
    expect(darkSchematicTheme.selectionGlow).toBe(8)
    expect(schematicTheme.selectionGlow).toBe(0)
  })

  test("junctions are drawn in the wire colour", () => {
    expect(darkSchematicTheme.junction).toBe(darkSchematicTheme.wire)
  })

  test("the light palette keeps its look: flags in the symbol colour, markers in the PCB's red and amber, no fifth dot", () => {
    expect(schematicTheme.flag).toBe(schematicTheme.symbolOutline)
    expect([schematicTheme.markerError, schematicTheme.markerWarning]).toEqual(["#e5534b", "#e0a63a"])
    expect(schematicTheme.gridFifth).toBeUndefined()
  })

  test("both palettes name the same colours", () => {
    expect(Object.keys(darkSchematicTheme).filter((key) => key !== "gridFifth").sort()).toEqual(Object.keys(schematicTheme).sort())
  })

  test("the theme picks the palette, and the sheet draws with the one set last (light until set)", () => {
    expect(schematicThemeFor("light")).toBe(schematicTheme)
    expect(schematicThemeFor("dark")).toBe(darkSchematicTheme)
    expect(sheetPalette()).toBe(schematicTheme)
    setSheetPalette(darkSchematicTheme)
    expect(sheetPalette()).toBe(darkSchematicTheme)
    setSheetPalette(schematicTheme)
    expect(sheetPalette()).toBe(schematicTheme)
  })

  const TEXTS: (keyof SchematicPalette)[] = ["designator", "value", "netName", "pinName", "pinNumber", "titleText"]
  test.each([["light", schematicTheme], ["dark", darkSchematicTheme]] as const)("%s: designators, values and labels are at least 4.5:1 on the sheet", (_, palette) => {
    for (const key of TEXTS) {
      const ratio = contrastRatio(palette[key] as string, palette.background)
      expect([key, ratio >= 4.5]).toEqual([key, true])
    }
  })

  test("the dark sheet's own marks read on it: wires, buses, flags, selection and markers at least 3:1", () => {
    for (const key of ["wire", "bus", "flag", "symbolOutline", "selection", "hover", "markerError", "markerWarning", "drawing"] as const) {
      expect([key, contrastRatio(darkSchematicTheme[key], darkSchematicTheme.background) >= 3]).toEqual([key, true])
    }
  })

  test("the dark grid is quiet: dots barely above the sheet, the fifth a step brighter", () => {
    const dot = contrastRatio(darkSchematicTheme.gridDot, darkSchematicTheme.background)
    const fifth = contrastRatio(darkSchematicTheme.gridFifth as string, darkSchematicTheme.background)
    expect(dot).toBeLessThan(2)
    expect(fifth).toBeGreaterThan(dot)
  })
})
