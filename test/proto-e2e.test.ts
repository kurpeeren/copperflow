// A small relay driver built on perfboard and on stripboard through the agent's tools: new_circuit writes it with a
// board kind and places it (the parts drop into holes), autoroute joins it, check_circuit finds nothing wrong, render
// draws both sides and export { as: "build" } writes the build sheet.
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { checkCircuit } from "../src/core/check.js"
import { renderCircuit } from "../src/core/render.js"
import { exportBuildSheet } from "../src/core/build-sheet.js"
import type { NewPart } from "../src/core/new-circuit.js"
import { newCircuit } from "../src/mcp/new-circuit.js"
import { autoroute } from "../src/mcp/route-tools.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

/** A 24 V relay coil switched by an NPN from a logic input, with a flyback diode and an LED showing it is on. */
export const RELAY_DRIVER: { parts: NewPart[]; nets: Record<string, string[]> } = {
  parts: [
    { name: "J1", kind: "connector", footprint: "screw2", props: { pinLabels: { pin1: "V24", pin2: "GND" } } },
    { name: "J2", kind: "pinheader", props: { pinCount: 2, pitch: "2.54mm" } },
    { name: "J3", kind: "connector", footprint: "screw2", props: { pinLabels: { pin1: "COIL_P", pin2: "COIL_N" } } },
    { name: "Q1", kind: "transistor", footprint: "to92" },
    { name: "R1", kind: "resistor", value: "4.7k", footprint: "axial6.3x10.16" },
    { name: "R2", kind: "resistor", value: "10k", footprint: "axial6.3x10.16" },
    { name: "R3", kind: "resistor", value: "10k", footprint: "axial6.3x10.16" },
    { name: "D1", kind: "diode", footprint: "axial4x10.16" },
    { name: "D2", kind: "led", footprint: "led5mm" },
  ],
  nets: {
    V24: ["J1.pin1", "J3.pin1", "D1.pin2", "R3.pin1"],
    GND: ["J1.pin2", "J2.pin2", "Q1.pin1", "R2.pin2"],
    CTRL: ["J2.pin1", "R1.pin1"],
    BASE: ["R1.pin2", "R2.pin1", "Q1.pin2"],
    DRV: ["Q1.pin3", "J3.pin2", "D1.pin1", "D2.pin2"],
    LEDA: ["R3.pin2", "D2.pin1"],
  },
}

const engine = inProcessEngine as never

async function build(kind: "perfboard" | "stripboard") {
  const root = await mkdtemp(join(tmpdir(), `cf-${kind}-`))
  const file = "relay.circuit.tsx"
  const written = await newCircuit(root, { file, ...RELAY_DRIVER, board: { kind } }, engine)
  const routed = await autoroute({ root, engine }, { file })
  const check = await checkCircuit(root, file, { engine })
  return { root, file, written, routed, check }
}

const PIECES = /proto-|unrouted/

describe.each(["perfboard", "stripboard"] as const)("a relay driver on %s", (kind) => {
  test("is written, placed on the holes, routed and checked clean", async () => {
    const { root, file, written, routed, check } = await build(kind)
    expect(written).toMatch(new RegExp(`Change c\\d+: wrote ${file}`))
    expect(await readFile(join(root, file), "utf8")).toMatch(new RegExp(`<board kind="${kind}" columns=\\{\\d+\\} rows=\\{\\d+\\}`))
    expect(routed).toMatch(/^Change c\d+: Joined (\d+) of \1 connections/)
    const findings = [...check.errors, ...check.warnings].filter((group) => PIECES.test(group.type))
    expect(findings).toEqual([])
    expect(check.unrouted).toEqual([])
    const top = await renderCircuit(root, file, { view: "board", side: "top" }, { engine })
    const bottom = await renderCircuit(root, file, { view: "board", side: "bottom" }, { engine })
    expect(top.what).toMatch(new RegExp(`^the ${kind} as built, top`))
    expect(bottom.what).toMatch(new RegExp(`^the ${kind} as built, bottom`))
    const sheet = await exportBuildSheet(root, file, { engine })
    expect(sheet.files).toEqual(["relay-build.md", "relay-build-top.png", "relay-build-bottom.png"])
    const text = await readFile(join(root, "relay-build.md"), "utf8")
    expect(text).toMatch(new RegExp(`^# relay: ${kind} build sheet`))
    expect(text).toMatch(/\| Q1 \| transistor \| to92 \|/)
    if (kind === "stripboard") expect(text).toMatch(/## Cuts \(bottom, \d+\)/)
    else expect(text).toMatch(/## Solder runs \(bottom, \d+\)/)
  }, 120_000)
})
