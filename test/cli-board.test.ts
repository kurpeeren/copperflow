import { beforeEach, describe, expect, test } from "vitest"
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { runCli } from "../src/cli-commands.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "main.circuit.tsx"
const CIRCUIT = `export default () => (
  <board width="10mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={0} pcbY={0} schX={0} schY={0} />
  </board>
)
`
let root: string
let out: string[]
let err: string[]
const run = (...args: string[]) => runCli(args, root, { out: (s) => out.push(s), err: (s) => err.push(s) }, { engine: inProcessEngine })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-cli-board-"))
  await writeFile(join(root, FILE), CIRCUIT)
  await cp(fileURLToPath(new URL("./fixtures/dxf", import.meta.url)), join(root, "dxf"), { recursive: true })
  out = []
  err = []
})

describe("copperflow board --dxf", () => {
  test("sets the board from the drawing and prints the answer", async () => {
    expect(await run("board", FILE, "--dxf", "dxf/rectangle-holes.dxf")).toBe(0)
    expect(out.join("\n")).toMatch(/^Change c\d+: board outline from rectangle-holes\.dxf: 4 corners, 82 x 54 mm \(drawing in mm, moved by -41, -27\)\n4 holes: /)
    expect(await readFile(join(root, FILE), "utf8")).toContain("<hole x={-37} y={-23} diameter={3.2} />")
  })

  test("takes --layer, --units, --origin keep and --replace", async () => {
    expect(await run("board", FILE, "--dxf", "dxf/rectangle-holes.dxf")).toBe(0)
    expect(await run("board", FILE, "--dxf", "dxf/inner-shape.dxf", "--layer", "Board", "--units", "inch", "--origin", "keep", "--replace")).toBe(0)
    expect(out.at(-1)).toMatch(/2540 x 1524 mm \(drawing read in inches as asked, not moved\)\n1 inner shape kept clear as keepout:1 \(not cut out of the board\)\nReplaced the board's 4 holes\.\nNot used: 1 circle outside the outline\n1 placed part is now outside the outline: R1; move it inside$/)
  })

  test("refuses a bad option and a board with holes without --replace", async () => {
    expect(await run("board", FILE, "--dxf", "dxf/rounded.dxf", "--units", "feet")).toBe(1)
    expect(err.at(-1)).toBe("copperflow: --units must be mm or inch, not feet")
    expect(await run("board", FILE)).toBe(1)
    expect(err.at(-1)).toMatch(/Missing --dxf/)
    await run("board", FILE, "--dxf", "dxf/rectangle-holes.dxf")
    expect(await run("board", FILE, "--dxf", "dxf/rounded.dxf")).toBe(1)
    expect(err.at(-1)).toBe("copperflow: The board already has 4 holes; pass replace: true to replace them")
  })

  test("is in the usage text", async () => {
    await run("help")
    expect(out.join("\n")).toContain("copperflow board <file> --dxf <path> [--layer <name>] [--units mm|inch] [--origin keep] [--replace]")
  })
})
