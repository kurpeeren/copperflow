// render's view "board": the bare board as made, through the MCP tool and the CLI, its line of text, its options and
// its refusals.
import { readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { loadImage } from "@napi-rs/canvas"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { runCli } from "../src/cli-commands.js"
import { CANVAS_MISSING, renderCircuit } from "../src/core/render.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { shortTempDir } from "./helpers/short-temp.js"

const BOARD = `export default () => (
  <board width="20mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-4} pcbY={0} schX={0} schY={0} />
    <capacitor name="C1" capacitance="1uF" footprint="0603" pcbX={4} pcbY={0} schX={3} schY={0} />
    <trace from=".R1 > .pin2" to=".C1 > .pin1" />
  </board>
)
`

let root: string
let client: Client

beforeEach(async () => {
  root = await shortTempDir("cf-board-")
  await writeFile(join(root, "io.circuit.tsx"), BOARD)
  const server = createCopperflowServer(root, { engine: inProcessEngine, renderer: () => import("../studio/src/render/node-render.js") })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

afterEach(async () => {
  await client.close()
  await rm(root, { recursive: true, force: true })
})

type Answer = { isError?: boolean; content: Array<{ type: string; data?: string; text?: string }> }
const call = async (args: Record<string, unknown>) => (await client.callTool({ name: "render", arguments: { file: "io.circuit.tsx", ...args } })) as Answer

describe("the render tool's board view", () => {
  test("answers the board as made, its line saying side, look, size and pixels", async () => {
    const result = await call({ view: "board", width: 800 })
    expect(result.isError).not.toBe(true)
    expect(result.content[1]?.text).toBe("io: the board as made, top, green mask, ENIG, 20 x 10 mm; 800 x 400 px")
    const image = await loadImage(Buffer.from(result.content[0]?.data ?? "", "base64"))
    expect([image.width, image.height]).toEqual([800, 400])
  })

  test("the bottom, a look, and parts to zoom to", async () => {
    const bottom = await call({ view: "board", side: "bottom", look: { mask: "black", finish: "hasl", silk: "black" }, width: 640 })
    expect(bottom.content[1]?.text).toBe("io: the board as made, bottom seen from below (left and right swapped), black mask, HASL, black print, 20 x 10 mm; 640 x 320 px")
    const zoomed = await call({ view: "board", parts: ["R1"], width: 400 })
    expect(zoomed.content[1]?.text).toMatch(/^io: the board as made, top, green mask, ENIG, around R1; 400 x \d+ px$/)
  })

  test("without a width a small board gets at least 40 px/mm; up to 4000 px is allowed", async () => {
    expect((await call({ view: "board" })).content[1]?.text).toBe("io: the board as made, top, green mask, ENIG, 20 x 10 mm; 1024 x 512 px")
    expect((await call({ view: "board", width: 3000 })).content[1]?.text).toMatch(/; 3000 x 1500 px$/)
  })

  test("refuses a change mark, a page, a wide PCB view and an unknown look", async () => {
    const changed = await call({ view: "board", since: "HEAD" })
    expect(changed).toMatchObject({ isError: true, content: [{ text: "A change is drawn on the PCB only" }] })
    expect((await call({ view: "board", page: "Main" })).content[0]?.text).toBe("page is for the schematic only; the board has no pages")
    expect((await call({ view: "pcb", width: 3000 })).content[0]?.text).toBe("width must be a whole number of pixels from 320 to 2000")
    const pink = await call({ view: "board", look: { mask: "pink" } })
    expect(pink.isError).toBe(true)
    expect(pink.content[0]?.text).toMatch(/mask/)
    expect((await call({ view: "pcb", side: "bottom" })).content[0]?.text).toBe("side and look are for view board only")
  })
})

describe("copperflow render --view board", () => {
  const run = async (...args: string[]) => {
    const out: string[] = []
    const err: string[] = []
    const code = await runCli(args, root, { out: (s) => out.push(s), err: (s) => err.push(s) }, { engine: inProcessEngine })
    return { code, out: out.join("\n"), err: err.join("\n") }
  }

  test("writes each side beside the circuit with the options asked for", async () => {
    const top = await run("render", "io.circuit.tsx", "--view", "board", "--width", "400")
    expect(top).toEqual({ code: 0, out: "Wrote io-board-top.png (400 x 200 px): the board as made, top, green mask, ENIG, 20 x 10 mm", err: "" })
    expect((await readFile(join(root, "io-board-top.png"))).subarray(1, 4).toString()).toBe("PNG")
    const bottom = await run("render", "io.circuit.tsx", "--view", "board", "--side", "bottom", "--mask", "white", "--finish", "hasl", "--silk", "black", "--width", "400")
    expect(bottom.out).toBe("Wrote io-board-bottom.png (400 x 200 px): the board as made, bottom seen from below (left and right swapped), white mask, HASL, 20 x 10 mm")
  })

  test("refuses a side or a look on another view, and a side that is not one", async () => {
    expect((await run("render", "io.circuit.tsx", "--mask", "red")).err).toBe("copperflow: side and look are for view board only")
    expect((await run("render", "io.circuit.tsx", "--view", "board", "--side", "left")).err).toBe("copperflow: --side must be top or bottom, not left")
  })
})

describe("the board view without the canvas package", () => {
  test("says how to install it", async () => {
    const notFound = Object.assign(new Error("Cannot find package '@napi-rs/canvas' imported from png.js"), { code: "ERR_MODULE_NOT_FOUND" })
    await expect(renderCircuit(root, "io.circuit.tsx", { view: "board" }, { engine: inProcessEngine, canvas: () => Promise.reject(notFound) })).rejects.toThrow(CANVAS_MISSING)
  })
})
