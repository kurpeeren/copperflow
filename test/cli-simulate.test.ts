import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { runCli } from "../src/cli-commands.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const CIRCUIT = `export default () => (
  <board width="20mm" height="20mm">
    <resistor name="R1" resistance="10k" footprint="0603" />
    <resistor name="R2" resistance="10k" footprint="0603" />
    <switch name="SW1" footprint="0603" />
    <trace from="R1.pin1" to="net.IN" />
    <trace from="R1.pin2" to="net.OUT" />
    <trace from="R2.pin1" to="net.OUT" />
    <trace from="R2.pin2" to="net.SWN" />
    <trace from="SW1.pin1" to="net.SWN" />
    <trace from="SW1.pin2" to="net.GND" />
  </board>
)
`

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cf-cli-sim-"))
  await writeFile(join(root, "main.circuit.tsx"), CIRCUIT)
  return root
}

async function cli(root: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(args, root, { out: (text) => out.push(text), err: (text) => err.push(text) }, { engine: inProcessEngine })
  return { code, out: out.join("\n"), err: err.join("\n") }
}

test("copperflow simulate prints what the tool answers", async () => {
  const root = await project()
  const open = await cli(root, ["simulate", "main.circuit.tsx", "--set", "IN=12", "--set", "GND=0"])
  expect(open.code).toBe(0)
  expect(open.out).toContain("Nets: GND 0 V, IN 12.0 V, OUT 12.0 V, SWN 12.0 V")
  const closed = await cli(root, ["simulate", "main.circuit.tsx", "--set", "IN=12", "--set", "GND=0", "--closed", "SW1"])
  expect(closed.out).toContain("OUT 6.00 V")
  const floating = await cli(root, ["simulate", "main.circuit.tsx", "--set", "IN=open", "--set", "GND=0"])
  expect(floating.out).toContain("IN floating")
})

test("copperflow simulate refuses a set that is not net=volts", async () => {
  const root = await project()
  const bad = await cli(root, ["simulate", "main.circuit.tsx", "--set", "IN"])
  expect(bad.code).toBe(1)
  expect(bad.err).toContain('--set takes net=volts or net=open, e.g. --set V12=12; got "IN"')
})

test("copperflow spice writes the netlist to a file", async () => {
  const root = await project()
  const done = await cli(root, ["spice", "main.circuit.tsx", "--set", "IN=12", "--set", "GND=0", "--out", "main.cir"])
  expect(done.code).toBe(0)
  expect(done.out).toBe("Wrote main.cir (SPICE3 netlist; copperflow runs no simulator)")
  const text = await readFile(join(root, "main.cir"), "utf8")
  expect(text).toContain("R_R1 IN OUT 10000")
  expect(text).toContain(".op\n.end\n")
})
