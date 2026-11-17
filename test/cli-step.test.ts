import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { runCli } from "../src/cli-commands.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { shortTempDir } from "./helpers/short-temp.js"
import { productNames, readStep, solids } from "./helpers/step-read.js"

const CIRCUIT = `export default () => (
  <board width="10mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={0} pcbY={0} schX={0} schY={0} />
    <chip name="U1" pcbX={3} pcbY={3} schX={4} schY={0} />
  </board>
)
`

let root: string
let out: string[]
let err: string[]
const run = (...args: string[]) => runCli(args, root, { out: (s) => out.push(s), err: (s) => err.push(s) }, { engine: inProcessEngine })
const exists = (path: string) => stat(join(root, path)).then(
  () => true,
  () => false,
)

beforeEach(async () => {
  root = await shortTempDir("cf-cli-step-")
  out = []
  err = []
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("copperflow step", () => {
  test("writes <name>.step beside the circuit and says what it holds and is not", async () => {
    await mkdir(join(root, "boards"))
    await writeFile(join(root, "boards", "led.circuit.tsx"), CIRCUIT)
    const code = await run("step", "boards/led.circuit.tsx")
    expect(err).toEqual([])
    expect(code).toBe(0)
    expect(out.join("\n")).toBe(
      ["Wrote boards/led.step: the board and 2 parts as solids.", "led.step: parts are boxes, not their real shapes; heights marked typical come from a package table, assumed ones are guesses (typical: R1; assumed: U1)."].join("\n"),
    )
    const file = readStep(await readFile(join(root, "boards", "led.step"), "utf8"))
    expect(productNames(file)).toEqual(["led", "board", "R1", "U1"])
    expect(solids(file).every((solid) => solid.closed)).toBe(true)
  })

  test("--out writes to that file in the project; the same design writes the same bytes", async () => {
    await writeFile(join(root, "led.circuit.tsx"), CIRCUIT)
    expect(await run("step", "led.circuit.tsx", "--out", "cad/board.step")).toBe(0)
    expect(out[0]?.split("\n")[0]).toBe("Wrote cad/board.step: the board and 2 parts as solids.")
    const first = await readFile(join(root, "cad", "board.step"), "utf8")
    expect(await run("step", "led.circuit.tsx", "--out", "cad/board.step")).toBe(0)
    expect(await readFile(join(root, "cad", "board.step"), "utf8")).toBe(first)
    expect(await exists("led.step")).toBe(false)
  })

  test("refuses a file outside the project and one that is not .step", async () => {
    await writeFile(join(root, "led.circuit.tsx"), CIRCUIT)
    expect(await run("step", "led.circuit.tsx", "--out", "../board.step")).toBe(1)
    expect(err.at(-1)).toMatch(/outside the project/)
    expect(await run("step", "led.circuit.tsx", "--out", "board.txt")).toBe(1)
    expect(err.at(-1)).toBe("copperflow: --out takes a file ending in .step (got board.txt)")
  })
})
