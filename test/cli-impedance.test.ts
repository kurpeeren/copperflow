import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "vitest"
import { runCli } from "../src/cli-commands.js"
import { shortTempDir } from "./helpers/short-temp.js"

async function run(args: string[], root: string): Promise<{ code: number; out: string; err: string }> {
  let [out, err] = ["", ""]
  const code = await runCli(["--root", root, ...args], root, { out: (t) => (out += t), err: (t) => (err += t) })
  return { code, out, err }
}

test("impedance prints the calculation for the project's stack with the equations' limits", async () => {
  const root = await shortTempDir("cf-imp-")
  const { code, out } = await run(["impedance", "--single", "50", "--pair", "90", "--gap", "0.2"], root)
  expect(code).toBe(0)
  const lines = out.split("\n")
  expect(lines[0]).toBe("Stack: jlcpcb-2layer, 1.6 mm board, dielectric 1.53 mm, er 4.6, copper 0.035 mm, solder mask (not counted)")
  expect(lines[1]).toMatch(/^50 ohm single: 2\.\d+ mm width$/)
  expect(lines[2]).toMatch(/^90 ohm differential: 1\.\d+ mm width at a 0\.2 mm gap on a 1\.6 mm board$/)
  expect(out).toContain("The router does not route pairs together and does not tune lengths")
  expect(out).toContain("Hammerstad and Jensen")
})

test("impedance with --width gives the impedance of that width, and the gap for a pair", async () => {
  const root = await shortTempDir("cf-imp-")
  const { out } = await run(["impedance", "--width", "0.5", "--pair", "120"], root)
  expect(out).toMatch(/0\.5 mm width gives [\d.]+ ohm single/)
  expect(out).toMatch(/120 ohm differential: 0\.3 mm width at a [\d.]+ mm gap on a 1\.6 mm board/)
})

test("impedance refuses with a sentence when the stack is not known", async () => {
  const root = await shortTempDir("cf-imp-")
  await writeFile(join(root, "rules.yaml"), "fabrication:\n  profile: jlcpcb-4layer\n")
  const { code, err } = await run(["impedance", "--single", "50"], root)
  expect(code).toBe(1)
  expect(err).toContain("the profile jlcpcb-4layer gives no dielectricHeight; set fabrication.dielectricHeight in rules.yaml")
})
