import { describe, expect, test } from "vitest"
import { escapeXml, PAGE_MM, printImageSize, printPageHtml, PRINT_PX_PER_MM, sheetSvg } from "../studio/src/shell/print-page.js"
import { MENUS, menuItems } from "../studio/src/shell/menus.js"
import { commandOwner } from "../studio/src/shell/command-owners.js"

const sheet = { title: "led <test> · PCB", image: "data:image/png;base64,AAAA", width: 10, height: 5 }

describe("File → Print… and Export → PDF…", () => {
  test("the board prints on the light sheet's paper, not the PCB view's dark background", async () => {
    const { BOARD_PAPER } = await import("../studio/src/shell/print-page.js")
    const { schematicTheme } = await import("../studio/src/pcb/schematic-theme.js")
    const { PALETTE } = await import("../studio/src/pcb/ctx.js")
    expect(BOARD_PAPER()).toBe(schematicTheme.background)
    expect(BOARD_PAPER()).not.toBe(PALETTE.background)
  })

  test("are items the app runs, and no menu item is still to come", () => {
    const items = MENUS.flatMap(menuItems)
    expect(items).toContainEqual({ label: "Print…", command: "print" })
    expect(items).toContainEqual({ label: "PDF…", command: "exportPdf" })
    expect(commandOwner("print")).toBe("app")
    expect(commandOwner("exportPdf")).toBe("app")
    expect(items.filter((item) => item.pending !== undefined)).toEqual([])
  })

  test("each sheet's image fits an A4 landscape page less its margin and title line", () => {
    const size = printImageSize()
    expect(size.width).toBe((PAGE_MM.width - 2 * PAGE_MM.margin) * PRINT_PX_PER_MM)
    expect(size.height).toBeLessThan((PAGE_MM.height - 2 * PAGE_MM.margin) * PRINT_PX_PER_MM)
  })

  test("a sheet is an SVG in mm with its title, escaped, and its image", () => {
    const svg = sheetSvg(sheet)
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="277mm" height="190mm"/)
    expect(svg).toContain("led &lt;test&gt; · PCB")
    expect(svg).toContain('href="data:image/png;base64,AAAA"')
    expect(escapeXml(`"a" & 'b'`)).toBe("&quot;a&quot; &amp; &#39;b&#39;")
  })

  test("the page prints one A4 landscape sheet per drawing, without raw colours", () => {
    const html = printPageHtml("led", [sheet, { ...sheet, title: "second" }])
    expect(html).toContain("@page { size: A4 landscape")
    expect(html.match(/<section class="sheet">/g)).toHaveLength(2)
    expect(html).toContain("<title>led</title>")
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
  })
})
