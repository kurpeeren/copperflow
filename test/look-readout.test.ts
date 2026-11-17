import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { solidModel } from "../src/engine/solid/model.js"
import { LookReadout, LookParts } from "../studio/src/look/LookPanel.js"
import { BOTTOM, KEY_TURN, orbitKey, START, TOP } from "../studio/src/look/orbit.js"
import { hoverText, lookReadout } from "../studio/src/look/readout.js"

const MAIN = "main.circuit.tsx"
const model = solidModel(
  buildDesign(
    {
      [MAIN]: `export default () => (<board width="40mm" height="25mm">
    <pinheader name="J1" pinCount={4} footprint="pinrow4" pcbX={0} pcbY={8} />
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={0} />
    <capacitor name="C1" capacitance="10uF" footprint="0805" pcbX={5} pcbY={0} layer="bottom" />
    <chip name="U1" pcbX={-8} pcbY={0} layer="bottom" />
  </board>)`,
    },
    MAIN,
  ),
)

describe("the 3D view's readout", () => {
  test("gives the board's size, the tallest part on each side and the total height", () => {
    expect(lookReadout(model)).toEqual({
      board: "Board 40 × 25 mm, 1.6 mm thick",
      top: "Tallest on top: J1, 8.5 mm, typical",
      bottom: "Tallest on bottom: C1, 1.45 mm, typical",
      total: "Total height: 11.55 mm",
      limits: "Parts are simple shapes, not their real models; heights marked typical come from a package table, assumed ones are guesses.",
    })
  })

  test("a side without parts says so, and the total counts only the board there", () => {
    const top = { ...model, parts: model.parts.filter((p) => p.side === "top") }
    expect(lookReadout(top).bottom).toBe("Tallest on bottom: none")
    expect(lookReadout(top).total).toBe("Total height: 10.1 mm")
  })

  test("is drawn as a list a screen reader reads, with the limits line", () => {
    const html = renderToStaticMarkup(createElement(LookReadout, { model }))
    expect(html).toContain("Board 40 × 25 mm, 1.6 mm thick")
    expect(html).toContain("Tallest on bottom: C1, 1.45 mm, typical")
    expect(html).toContain("Parts are simple shapes, not their real models; heights marked typical come from a package table, assumed ones are guesses.")
  })
})

describe("naming a part", () => {
  test("the hover text names the part and its height, and says typical or assumed when it is", () => {
    const [j1, , , u1] = model.parts
    expect(hoverText(j1!)).toBe("J1, 8.5 mm high, typical (top)")
    expect(hoverText({ ...j1!, state: "given", assumed: false })).toBe("J1, 8.5 mm high (top)")
    expect(hoverText(u1!)).toBe("U1, 1 mm high, assumed (bottom)")
  })

  test("the list of parts gives every part a focusable button carrying that text", () => {
    const html = renderToStaticMarkup(createElement(LookParts, { model, active: 3, onActive: () => undefined }))
    expect(html.match(/<button/g)).toHaveLength(4)
    expect(html).toContain("U1, 1 mm high, assumed (bottom)")
    expect(html).toMatch(/aria-pressed="true"[^>]*>U1/)
  })
})

describe("the 3D view's keys", () => {
  test("arrows turn it, Home resets it, T and B look at the top and the bottom", () => {
    expect(orbitKey(START, "ArrowLeft")).toEqual({ ...START, yaw: START.yaw + KEY_TURN })
    expect(orbitKey(START, "ArrowRight")).toEqual({ ...START, yaw: START.yaw - KEY_TURN })
    expect(orbitKey(START, "ArrowUp")).toEqual({ ...START, pitch: START.pitch + KEY_TURN })
    expect(orbitKey({ ...START, yaw: 100, zoom: 3 }, "Home")).toEqual(START)
    expect(orbitKey(START, "t")).toEqual(TOP)
    expect(orbitKey(START, "b")).toEqual(BOTTOM)
    expect(orbitKey(START, "x")).toBeUndefined()
  })

  test("the turn up and down stops at straight above and straight below", () => {
    expect(orbitKey(TOP, "ArrowUp")?.pitch).toBe(90)
    expect(orbitKey(BOTTOM, "ArrowDown")?.pitch).toBe(-90)
  })

  test("plus and minus zoom in and out", () => {
    expect(orbitKey(START, "+")!.zoom).toBeGreaterThan(1)
    expect(orbitKey(START, "-")!.zoom).toBeLessThan(1)
  })
})
