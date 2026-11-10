import { expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import type { WorldPad } from "../../src/engine/pcb.js"

const MAIN = "main.circuit.tsx"
const LAYOUT = "main.circuit.layout.json"

function circuit(pours: string): string {
  const body = [
    `<resistor name="R1" resistance="1k" footprint="0603" pcbX={-5} pcbY={0} />`,
    `<resistor name="R2" resistance="1k" footprint="0603" pcbX={5} pcbY={0} />`,
    `<trace from="R1.pin1" to="net.GND" />`,
    `<trace from="R2.pin1" to="net.GND" />`,
    `<trace from="R1.pin2" to="R2.pin2" />`,
    pours,
  ].join("\n")
  return `export default () => (<board width="20mm" height="12mm">${body}</board>)`
}

const build = (pours: string, layout?: string) => buildDesign({ [MAIN]: circuit(pours), ...(layout === undefined ? {} : { [LAYOUT]: layout }) }, MAIN)
const POUR = `<copperpour net="GND" layer="top" />`

function padOf(id: string): WorldPad {
  const found = build("").pcb.parts.flatMap((part) => part.pads).find((pad) => pad.id === id)
  if (!found) throw new Error(`no pad ${id}`)
  return found
}

test("a GND pin pair joined only by the pour counts as routed: its line leaves the ratsnest", () => {
  const without = build("")
  expect(without.pcb.ratsnest.map((line) => line.net).sort()).toEqual(["net.GND", "net:R1.pin2"].sort())
  const design = build(POUR)
  expect(design.pcb.pours[0]?.area).toBeGreaterThan(100)
  expect(design.pcb.ratsnest.map((line) => line.net)).toEqual(["net:R1.pin2"])
  expect(design.violations.find((v) => v.code === "unrouted")?.message).toBe("1 connection is not routed yet")
})

test("a pour on the other layer joins nothing of the top-side pads, so the line stays", () => {
  const design = build(`<copperpour net="GND" layer="bottom" />`)
  expect(design.pcb.ratsnest.map((line) => line.net).sort()).toEqual(["net.GND", "net:R1.pin2"].sort())
})

test("a GND track that touches only the pour is not floating, and carries GND", () => {
  const track = { t: "track", id: "t0001", net: "GND", layer: "top", width: 0.25, points: [{ x: 0, y: 4 }, { x: 2, y: 4 }], locked: false, by: "human" }
  const layout = `${JSON.stringify(track)}\n`
  expect(build("", layout).violations.filter((v) => v.code === "floating").map((v) => v.items)).toEqual([["t0001"]])
  const design = build(POUR, layout)
  expect(design.violations.filter((v) => v.code === "floating")).toEqual([])
  expect(design.pcb.tracks[0]?.net).toBe("net.GND")
})

test("a track of another net cutting the pour in two leaves the halves joined to their own pads only", () => {
  const a = padOf("R1#2")
  const track = { t: "track", id: "t0001", layer: "top", width: 0.25, points: [{ x: 0, y: -6 }, { x: 0, y: 6 }], locked: false, by: "human", net: "net:R1.pin2" }
  const design = build(POUR, `${JSON.stringify(track)}\n`)
  expect(a.net).toBe("net:R1.pin2")
  expect(design.pcb.pours[0]?.polygons).toHaveLength(2)
  expect(design.pcb.ratsnest.map((line) => line.net).sort()).toEqual(["net.GND", "net:R1.pin2"].sort())
})
