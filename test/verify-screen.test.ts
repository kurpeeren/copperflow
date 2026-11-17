// The Verify screen's plain data: the datasheet link at its page, the pin rows and the other items of verification.md,
// whether Mark verified may be pressed, and the page that prints the footprint at 1:1.
import { describe, expect, test } from "vitest"
import { generateFootprint } from "../src/engine/footprints/index.js"
import type { Footprint } from "../src/engine/footprints/types.js"
import { checkedAgainst, datasheetLink, firstPage } from "../studio/src/shell/verify-datasheet.js"
import { canMark, screenItems } from "../studio/src/shell/verify-checklist.js"
import { printFootprintHtml } from "../studio/src/shell/verify-print.js"

const HASH = "aaaaaaaaaaaa0000"
const CHECKLIST = [
  "# Verification of Thing",
  "",
  "Content: aaaaaaaaaaaa (changes when part.yaml changes)",
  "",
  "- [ ] Pins from Thing datasheet, page(s) 3-4: compare each pin",
  "- [x] Pin 1 is VDD (power in)",
  "- [ ] Pin 2 is GND (ground)",
  "- [ ] Pin 3 is GND (ground)",
  "- [ ] Footprint sot23 matches the package drawing",
  "",
].join("\n")
const PINS = { "1": { name: "VDD", type: "power_in" }, "2": { name: "GND", type: "ground" }, "3": { name: "GND", type: "ground" } } as const

function sot23(): Footprint {
  const footprint = generateFootprint("sot23")
  if ("error" in footprint) throw new Error(footprint.error)
  return footprint
}

describe("the datasheet link", () => {
  test("the first page named in datasheet_pages", () => {
    expect(firstPage("3-4")).toBe(3)
    expect(firstPage("1 (18-lead SOIC pinout), 4 (Table 1-1)")).toBe(1)
    expect(firstPage(undefined)).toBeUndefined()
    expect(firstPage("pinout table")).toBeUndefined()
  })

  test("a PDF link opens at that page; another link, or no page, opens as it is", () => {
    expect(datasheetLink("https://example.com/ds.pdf", "3-4")).toBe("https://example.com/ds.pdf#page=3")
    expect(datasheetLink("https://example.com/ds.PDF?rev=2#zoom=50", "1 (18-lead SOIC pinout), 4 (Table 1-1)")).toBe("https://example.com/ds.PDF?rev=2#page=1")
    expect(datasheetLink("https://example.com/ds.pdf", undefined)).toBe("https://example.com/ds.pdf")
    expect(datasheetLink("https://example.com/product/ds", "3")).toBe("https://example.com/product/ds")
  })

  test("Checked against starts from the datasheet's title and pages", () => {
    expect(checkedAgainst({ title: "MCP2515 datasheet DS20001801J", url: "https://x/ds.pdf" }, "1, 4")).toBe("MCP2515 datasheet DS20001801J, page(s) 1, 4")
    expect(checkedAgainst({ url: "https://x/ds.pdf" }, undefined)).toBe("https://x/ds.pdf")
    expect(checkedAgainst(undefined, undefined)).toBe("")
  })
})

describe("the items on the screen", () => {
  test("pin rows carry their item; every other item is listed apart; power and ground say so in words", () => {
    const items = screenItems(CHECKLIST, HASH, PINS, sot23())
    expect(items.pins).toEqual([
      { number: "1", name: "VDD", type: "power in", kind: "Power", pads: 1, item: { text: "Pin 1 is VDD (power in)", ticked: true } },
      { number: "2", name: "GND", type: "ground", kind: "Ground", pads: 1, item: { text: "Pin 2 is GND (ground)", ticked: false } },
      { number: "3", name: "GND", type: "ground", kind: "Ground", pads: 1, item: { text: "Pin 3 is GND (ground)", ticked: false } },
    ])
    expect(items.others.map((item) => item.text)).toEqual(["Pins from Thing datasheet, page(s) 3-4: compare each pin", "Footprint sot23 matches the package drawing"])
    expect(items).toMatchObject({ total: 5, open: 4, stale: false })
  })

  test("ticks made before the part changed show as open, and the screen says so", () => {
    const items = screenItems(CHECKLIST, "bbbbbbbbbbbb0000", PINS, sot23())
    expect(items.stale).toBe(true)
    expect(items.open).toBe(5)
    expect(items.pins[0]?.item?.ticked).toBe(false)
  })

  test("Mark verified only with every item ticked, a name, the id typed back and no placeholder", () => {
    const done = screenItems(CHECKLIST.replace(/- \[ \]/g, "- [x]"), HASH, PINS, sot23())
    const form = { by: "Eren", against: "Thing datasheet", confirm: "U1" }
    expect(canMark("U1", done, form, false)).toBe(true)
    expect(canMark("U1", screenItems(CHECKLIST, HASH, PINS, sot23()), form, false)).toBe(false)
    expect(canMark("U1", done, { ...form, by: " " }, false)).toBe(false)
    expect(canMark("U1", done, { ...form, confirm: "u1" }, false)).toBe(false)
    expect(canMark("U1", done, form, true)).toBe(false)
  })
})

describe("Print at 1:1", () => {
  test("an SVG sized in mm, the pads at true size, a 10 mm scale bar beside them", () => {
    const html = printFootprintHtml("U1 sot23", sot23())
    expect(html).toMatch(/<svg [^>]*width="[\d.]+mm" height="[\d.]+mm" viewBox="[-\d. ]+"/)
    expect(html).toContain('<rect class="scale" x=')
    expect(html).toContain('width="10" height="0.4"')
    expect(html).toContain(">10 mm</text>")
    expect(html).toContain('width="0.6" height="0.95"')
    expect(html).toContain(">1</text>")
    expect(html).toContain("Print at 100 % (actual size), not fit to page")
  })
})
