import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { runCli } from "../src/cli-commands.js"
import { readEasyeda } from "../src/engine/fab/easyeda-read.js"
import { exportTool } from "../src/mcp/export-tool.js"
import { QUIET } from "../src/mcp/tool-activity.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { shortTempDir } from "./helpers/short-temp.js"

const CIRCUIT = `export default () => (
  <board width="10mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={0} pcbY={0} schX={0} schY={0} />
  </board>
)
`
const OPEN = "Open it in EasyEDA Standard with File > Open > EasyEDA...; rebuild the copper areas there (Shift+B) to fill them."

let root: string
let out: string[]
let err: string[]
const run = (...args: string[]) => runCli(args, root, { out: (s) => out.push(s), err: (s) => err.push(s) }, { engine: inProcessEngine })
const report = QUIET

beforeEach(async () => {
  root = await shortTempDir("cf-cli-easyeda-")
  out = []
  err = []
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("copperflow easyeda", () => {
  test("writes <name>-easyeda.json beside the circuit and says what it holds and how to open it", async () => {
    await mkdir(join(root, "boards"))
    await writeFile(join(root, "boards", "led.circuit.tsx"), CIRCUIT)
    expect(await run("easyeda", "boards/led.circuit.tsx")).toBe(0)
    expect(err).toEqual([])
    expect(out.join("\n")).toBe(["Wrote boards/led-easyeda.json for EasyEDA Standard: 1 part, 2 pads, 0 tracks, 0 vias, 0 holes, 0 copper areas, 0 board texts, 0 nets.", OPEN].join("\n"))
    const document = readEasyeda(await readFile(join(root, "boards", "led-easyeda.json"), "utf8"))
    expect(document.shapes.map((shape) => shape.kind)).toEqual(["TRACK", "LIB"])
  })

  test("writes the project file --out names, and refuses one that is not .json or lies outside the project", async () => {
    await writeFile(join(root, "led.circuit.tsx"), CIRCUIT)
    expect(await run("easyeda", "led.circuit.tsx", "--out", "cad/board.json")).toBe(0)
    expect(out.join("\n")).toMatch(/^Wrote cad\/board\.json for EasyEDA Standard: 1 part, 2 pads,/)
    expect(await run("easyeda", "led.circuit.tsx", "--out", "board.txt")).toBe(1)
    expect(err.at(-1)).toBe("copperflow: --out takes a file ending in .json (got board.txt)")
    expect(await run("easyeda", "led.circuit.tsx", "--out", "../board.json")).toBe(1)
    expect(err.at(-1)).toMatch(/outside the project/)
    expect(await run("easyeda", "led.circuit.tsx", "--out", "cad/a:b.json")).toBe(1)
    expect(err.at(-1)).toMatch(/cannot contain ":"/)
  })

  test("writes over an earlier export but never over another JSON file of the project", async () => {
    await writeFile(join(root, "led.circuit.tsx"), CIRCUIT)
    expect(await run("easyeda", "led.circuit.tsx")).toBe(0)
    expect(await run("easyeda", "led.circuit.tsx")).toBe(0)
    const layout = '{"t":"meta","next":{"track":1,"via":1}}\n'
    await writeFile(join(root, "led.circuit.layout.json"), layout)
    expect(await run("easyeda", "led.circuit.tsx", "--out", "led.circuit.layout.json")).toBe(1)
    expect(err.at(-1)).toBe("copperflow: led.circuit.layout.json is there and is not an EasyEDA PCB document; name another file to write")
    expect(await readFile(join(root, "led.circuit.layout.json"), "utf8")).toBe(layout)
  })
})

describe("the export tool as easyeda", () => {
  test("writes the document and answers what it holds", async () => {
    await writeFile(join(root, "led.circuit.tsx"), CIRCUIT)
    const answer = await exportTool({ root, engine: inProcessEngine, report }, { file: "led.circuit.tsx", as: "easyeda" })
    expect(answer.isError).toBeUndefined()
    expect(answer.content).toEqual([{ type: "text", text: ["Wrote led-easyeda.json for EasyEDA Standard: 1 part, 2 pads, 0 tracks, 0 vias, 0 holes, 0 copper areas, 0 board texts, 0 nets.", OPEN].join("\n") }])
    expect(JSON.parse(await readFile(join(root, "led-easyeda.json"), "utf8")).head.docType).toBe("3")
  })

  test("takes out as the file and refuses a look", async () => {
    await writeFile(join(root, "led.circuit.tsx"), CIRCUIT)
    const written = await exportTool({ root, engine: inProcessEngine, report }, { file: "led.circuit.tsx", as: "easyeda", out: "cad/led.json" })
    expect(written.content).toEqual([expect.objectContaining({ text: expect.stringMatching(/^Wrote cad\/led\.json/) })])
    const refused = await exportTool({ root, engine: inProcessEngine, report }, { file: "led.circuit.tsx", as: "easyeda", look: { mask: "black" } })
    expect(refused.isError).toBe(true)
  })
})
