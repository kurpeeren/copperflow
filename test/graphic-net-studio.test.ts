// The Properties of a drawing on copper in the Studio: a Net row offering the circuit's nets and "No net", and the
// edit a choice sends (null clears the net). Plain logic; no DOM.
import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { boardFieldEdit, boardProperties } from "../studio/src/pcb/pour-props.js"

const MAIN = "main.circuit.tsx"
const SQUARE = `<svg xmlns="http://www.w3.org/2000/svg" width="2mm" height="2mm" viewBox="0 0 2 2"><rect width="2" height="2" fill="black"/></svg>`
const source = (items: string) => `export default () => (<board width="20mm" height="12mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-5} pcbY={0} />
    <trace from="R1.pin1" to="net.GND" />
    <trace from="R1.pin2" to="net.SIG" />
    ${items}
  </board>)`
const build = (items: string) => buildDesign({ [MAIN]: source(items), "graphics/square.svg": SQUARE }, MAIN)

describe("a drawing's Net row", () => {
  test("shows the net of a drawing on copper, offers the nets and No net, and sends the change", () => {
    const design = build(`<boardgraphic file="graphics/square.svg" layer="top" net="GND" x={4} y={0} width={2} />`)
    const row = boardProperties(design, "boardgraphic:1")?.rows.find((one) => one.field === "net")
    expect(row?.value).toBe("GND")
    expect(row?.choices?.map((one) => one.label)).toEqual(["No net", "GND", "SIG"])
    expect(boardFieldEdit(design, "boardgraphic:1", "net", "SIG")).toEqual({ edit: { kind: "setBoardGraphic", id: "boardgraphic:1", props: { net: "SIG" } }, summary: "set boardgraphic:1 net=SIG" })
    expect(boardFieldEdit(design, "boardgraphic:1", "net", "")).toEqual({ edit: { kind: "setBoardGraphic", id: "boardgraphic:1", props: { net: null } }, summary: "set boardgraphic:1 net=no net" })
  })

  test("is empty for a drawing of no net, and absent off copper", () => {
    expect(boardProperties(build(`<boardgraphic file="graphics/square.svg" layer="top" x={4} y={0} width={2} />`), "boardgraphic:1")?.rows.find((one) => one.field === "net")?.value).toBe("")
    expect(boardProperties(build(`<boardgraphic file="graphics/square.svg" layer="top-silkscreen" x={4} y={0} width={2} />`), "boardgraphic:1")?.rows.some((one) => one.field === "net")).toBe(false)
  })
})
