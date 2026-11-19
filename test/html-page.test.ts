// The one-file web page of a design (html-page.ts): pure, data in, HTML out.
import { describe, expect, test } from "vitest"
import { escapeHtml, htmlPage, type PageData } from "../src/core/html-page.js"
import { formatHtmlExport } from "../src/core/html-export.js"

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const picture = (alt: string) => ({ png: PNG, width: 1600, height: 900, alt })

function data(overrides: Partial<PageData> = {}): PageData {
  return {
    name: "io-8",
    version: "0.4.1",
    date: "2026-01-02",
    report: ["Board: 40 x 30 mm, 2 layers. Checks: 0 errors, 0 unrouted connections, no warnings.", "Ready for bare boards: yes", "Ready for assembly: no: 1 library part is not verified"],
    schematic: [{ page: "Main", picture: picture('Schematic page "Main"') }, { page: "Inputs", picture: picture('Schematic page "Inputs"') }],
    board: [picture("PCB, whole board"), picture("the board as made, top"), picture("the board as made, bottom")],
    threeD: [picture("3D from iso, parts as simple shapes, not their real models")],
    bom: [
      { designators: ["R1", "R2"], quantity: 2, kind: "resistor", value: "1k", footprint: "0402", manufacturer: "", mpn: "", supplier: "jlcpcb C11702", datasheet: "" },
      { designators: ["U1"], quantity: 1, kind: "chip", value: "Opto", footprint: "SOIC-4", manufacturer: "", mpn: "", supplier: "", datasheet: "", libraryPart: "opto", verified: false },
    ],
    downloads: [{ name: "io-8-bom.csv", mime: "text/csv", label: "Download the bill of materials (CSV)", bytes: new TextEncoder().encode("a,b\n") }],
    ...overrides,
  }
}

describe("the credit line", () => {
  test("is the last line of the page and links to the project in a new tab", () => {
    const html = htmlPage(data())
    const line = '<p class="made-with">Made with <a href="https://copperflow.kurpeeren.com" target="_blank" rel="noopener">copperflow</a> 0.4.1</p>'
    expect(html).toContain(line)
    expect(html.indexOf(line)).toBeGreaterThan(html.indexOf("</footer>"))
    expect(html.indexOf(line)).toBeLessThan(html.indexOf("<script>"))
  })
})

const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length

describe("the page", () => {
  test("has one heading, a section per part and a contents list", () => {
    const html = htmlPage(data())
    expect(html.startsWith("<!doctype html>")).toBe(true)
    expect(count(html, /<h1[ >]/g)).toBe(1)
    for (const id of ["files", "schematic", "board", "three-d", "bom"]) {
      expect(html).toContain(`<section id="${id}"`)
      expect(html).toContain(`href="#${id}"`)
    }
    expect(html).toContain("made with copperflow 0.4.1")
    expect(html).toContain("2026-01-02")
    expect(html).toContain("Ready for bare boards: yes")
  })

  test("has an image with alt text per picture", () => {
    const html = htmlPage(data())
    expect(count(html, /<img /g)).toBe(6)
    expect(count(html, /<img [^>]*alt="[^"]+"/g)).toBe(6)
    expect(html).toContain('alt="Schematic page &quot;Inputs&quot;"')
    expect(html).toContain("data:image/png;base64,iVBORw0KGgo=")
  })

  test("the BOM is a table with a row per line and names the parts not verified", () => {
    const html = htmlPage(data())
    expect(count(html, /<tr>/g)).toBe(3)
    expect(html).toContain(">R1, R2</td>")
    expect(html).toContain("jlcpcb C11702")
    expect(html).toContain("not verified")
  })

  test("the table scrolls in its own box, its cells do not break words and only the designators wrap", () => {
    const html = htmlPage(data())
    expect(html).toContain('<div class="table"><table>')
    expect(html).toContain('<td class="designators">R1, R2</td>')
    expect(html).toContain('<th scope="col" class="number">Quantity</th>')
    expect(html).toContain('<td class="number">2</td>')
    expect(html).toMatch(/\.table \{ overflow-x: auto;/)
    expect(html).toMatch(/th, td \{[^}]*white-space: nowrap;/)
    expect(html).toMatch(/td\.designators \{ white-space: normal;[^}]*max-width:/)
    expect(html).not.toMatch(/overflow-wrap: anywhere;[^}]*\}\s*th \{/)
    expect(html).not.toMatch(/th, td \{[^}]*overflow-wrap: anywhere/)
  })

  test("downloads are links with their name and type", () => {
    const html = htmlPage(data())
    expect(html).toContain('href="data:text/csv;base64,YSxiCg==" download="io-8-bom.csv"')
    expect(html).toContain("nothing is fetched")
  })

  test("says why the fabrication files are missing", () => {
    const html = htmlPage(data({ fabricationMissing: "the design has 1 error: short <between> A and B" }))
    expect(html).toContain("short &lt;between&gt; A and B")
  })

  test("hostile names come out as text", () => {
    const evil = "</script><b>x</b>\"'&"
    const html = htmlPage(
      data({
        name: evil,
        report: [evil],
        schematic: [{ page: evil, picture: picture(evil) }],
        bom: [{ designators: [evil], quantity: 1, kind: evil, value: evil, footprint: evil, manufacturer: "", mpn: "", supplier: evil, datasheet: "" }],
        downloads: [{ name: `${evil}.csv`, mime: "text/csv", label: evil, bytes: PNG }],
      }),
    )
    expect(html).not.toContain("<b>x</b>")
    expect(html).not.toContain("</script><b>")
    expect(html).toContain("&lt;/script&gt;&lt;b&gt;x&lt;/b&gt;&quot;&#39;&amp;")
  })

  test("refers to nothing outside the file", () => {
    const html = htmlPage(data())
    // The credit line's link is the one address on the page, and it is only followed when a person clicks it.
    expect(html.replaceAll("https://copperflow.kurpeeren.com", "")).not.toMatch(/https?:\/\//)
    expect(html).not.toMatch(/<script[^>]*src/i)
    expect(html).not.toMatch(/<link/i)
    expect(html).not.toMatch(/@import|url\(/i)
  })

  test("is the same for the same data", () => {
    expect(htmlPage(data())).toBe(htmlPage(data()))
  })

  test("escapeHtml escapes the five characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;")
  })
})

describe("the answer to an export", () => {
  test("ends with an offer of a README badge, and nothing is added to the person's files", () => {
    const lines = formatHtmlExport({ file: "io-8.html", bytes: 2_100_000, what: "the design as one page", split: undefined } as never).split("\n")
    expect(lines[0]).toContain("Wrote io-8.html")
    expect(lines.at(-1)).toBe("To credit copperflow in a README: [![Made with copperflow](https://img.shields.io/badge/made%20with-copperflow-c8702a)](https://copperflow.kurpeeren.com)")
  })
})
