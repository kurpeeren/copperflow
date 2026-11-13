import { beforeEach, describe, expect, test, vi } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import * as constructive from "../../src/engine/pcb-place/constructive.js"
import { placeBoard } from "../../src/engine/pcb-place/index.js"

vi.mock("../../src/engine/pcb-place/constructive.js", async (original) => {
  const real = await original<typeof import("../../src/engine/pcb-place/constructive.js")>()
  const counted = vi.fn()
  return { ...real, counted, construct: (...args: Parameters<typeof real.construct>) => (counted(), real.construct(...args)) }
})

const MAIN = "main.circuit.tsx"
const AHEAD = { connectorsAhead: true }
const board = (body: string) => ({ [MAIN]: `export default () => (\n  <board width="40mm" height="30mm">\n${body}\n  </board>\n)\n` })
const counted = (constructive as unknown as { counted: ReturnType<typeof vi.fn> }).counted
const runs = () => counted.mock.calls.length

describe("how many placement runs a board gets", () => {
  beforeEach(() => counted.mockClear())

  test("a connector wired only to a part a person placed serves no part: one run", () => {
    const files = board(
      [
        `<pinheader name="J1" pinCount={2} pitch="2.54mm" />`,
        `<chip name="U1" footprint="soic8" pcbX={10} pcbY={0} pinLabels={{ pin1: "A", pin2: "B" }} />`,
        `<resistor name="R1" resistance="1k" footprint="0603" />`,
        `<trace from="J1.pin1" to="U1.pin1" />`,
        `<trace from="J1.pin2" to="U1.pin2" />`,
        `<trace from="R1.pin1" to="U1.pin3" />`,
      ].join("\n"),
    )
    placeBoard(buildDesign(files, MAIN), AHEAD)
    expect(runs()).toBe(1)
  })

  test("a connector on ground only serves no part: one run", () => {
    const parts = Array.from({ length: 9 }, (_, i) => `<resistor name="R${i + 1}" resistance="1k" footprint="0603" />\n<trace from="R${i + 1}.pin1" to="net.GND" />`)
    const files = board([`<pinheader name="J1" pinCount={2} pitch="2.54mm" />`, `<trace from="J1.pin1" to="net.GND" />`, ...parts].join("\n"))
    const placement = placeBoard(buildDesign(files, MAIN), AHEAD)
    expect(runs()).toBe(1)
    // Asked for and not kept: the caller is told, so it does not compare two boards that are the same.
    expect(placement.notes.some((note) => note.startsWith("Connectors ahead was not kept"))).toBe(true)
  })

  test("the note about connectors ahead appears only when it was asked for", () => {
    const parts = Array.from({ length: 9 }, (_, i) => `<resistor name="R${i + 1}" resistance="1k" footprint="0603" />\n<trace from="R${i + 1}.pin1" to="net.GND" />`)
    const files = board([`<pinheader name="J1" pinCount={2} pitch="2.54mm" />`, `<trace from="J1.pin1" to="net.GND" />`, ...parts].join("\n"))
    const said = (options?: { connectorsAhead: boolean }) => placeBoard(buildDesign(files, MAIN), options).notes.some((note) => note.includes("Connectors ahead"))
    expect(said()).toBe(false)
    expect(said({ connectorsAhead: false })).toBe(false)
  })

  const served = board(
    [
      `<pinheader name="J1" pinCount={2} pitch="2.54mm" />`,
      `<chip name="U1" footprint="soic8" pinLabels={{ pin1: "A", pin2: "B" }} />`,
      `<trace from="J1.pin1" to="U1.pin1" />`,
      `<trace from="J1.pin2" to="U1.pin2" />`,
    ].join("\n"),
  )

  test("a connector wired to a part that moves serves it: two runs", () => {
    placeBoard(buildDesign(served, MAIN), AHEAD)
    expect(runs()).toBe(2)
  })

  test("the same board without connectorsAhead (the default): one run", () => {
    placeBoard(buildDesign(served, MAIN))
    expect(runs()).toBe(1)
  })
})
