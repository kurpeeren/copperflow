import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { InstanceCard, portAbout } from "../studio/src/instance-card.js"

test("the Inspector shows what an instance's sheet does and its sources, a link only for a web address", () => {
  const html = renderToStaticMarkup(createElement(InstanceCard, { instance: { does: "24 V digital input", sources: ["https://example.com/a.pdf", "javascript:alert(1)"] } }))
  expect(html).toContain("24 V digital input")
  expect(html).toContain('<a href="https://example.com/a.pdf"')
  expect(html).not.toContain('href="javascript')
  expect(html).toContain("<li>javascript:alert(1)</li>")
})

test("a sheet without a card shows nothing more", () => {
  expect(renderToStaticMarkup(createElement(InstanceCard, { instance: {} }))).toBe("")
})

test("a port's line says its type and what it carries", () => {
  expect(portAbout({ type: "input", carries: "0 to 24 V from the field" })).toBe("input, 0 to 24 V from the field")
  expect(portAbout({ type: "ground" })).toBe("ground")
  expect(portAbout({})).toBe("")
})
