import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { runCli } from "../src/cli-commands.js"
import { CANVAS_MISSING, renderCircuit } from "../src/core/render.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const sourceRenderer = () => import("../studio/src/render/node-render.js")
const BOARD = `export default () => (
  <board width="20mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-4} pcbY={0} schX={0} schY={0} />
    <capacitor name="C1" capacitance="1uF" footprint="0603" pcbX={4} pcbY={0} schX={3} schY={0} />
    <trace from=".R1 > .pin2" to=".C1 > .pin1" />
  </board>
)
`
const PNG_START = "iVBORw0KGgo"

let root: string
let client: Client

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-render-"))
  await writeFile(join(root, "io.circuit.tsx"), BOARD)
  const server = createCopperflowServer(root, { engine: inProcessEngine, renderer: sourceRenderer })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

afterEach(async () => {
  await client.close()
  await rm(root, { recursive: true, force: true })
})

describe("the render tool", () => {
  test("changes nothing but the file out names, and answers a PNG image and the line saying what it shows", async () => {
    const tool = (await client.listTools()).tools.find((t) => t.name === "render")
    expect(tool?.annotations).toMatchObject({ destructiveHint: false })
    expect(tool?.annotations?.readOnlyHint).not.toBe(true)
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(["file", "view", "page", "parts", "width", "side", "angle", "look", "change", "since", "out"])
    const result = await client.callTool({ name: "render", arguments: { file: "io.circuit.tsx", width: 400 } })
    const [image, text] = result.content as Array<{ type: string; data?: string; mimeType?: string; text?: string }>
    expect(result.isError).not.toBe(true)
    expect(image).toMatchObject({ type: "image", mimeType: "image/png" })
    expect(image?.data?.startsWith(PNG_START)).toBe(true)
    expect(text?.text).toMatch(/^io\.circuit\.tsx: PCB, whole board 20 x 10 mm; 400 x \d+ px$/)
  })

  test("a schematic page, and a missing part refused by name", async () => {
    const sheet = await client.callTool({ name: "render", arguments: { file: "io.circuit.tsx", view: "schematic" } })
    expect((sheet.content as Array<{ text?: string }>)[1]?.text).toMatch(/^io\.circuit\.tsx: Schematic page "Main"; 1024 x \d+ px$/)
    const missing = await client.callTool({ name: "render", arguments: { file: "io.circuit.tsx", parts: ["U9"] } })
    expect(missing.isError).toBe(true)
    expect((missing.content as Array<{ text: string }>)[0]?.text).toBe("No part named U9 on the board")
  })

  test("a width outside 320 to 2000 is refused by the schema", async () => {
    for (const width of [319, 2001, 512.5]) {
      const result = await client.callTool({ name: "render", arguments: { file: "io.circuit.tsx", width } })
      expect(result.isError).toBe(true)
      expect((result.content as Array<{ text: string }>)[0]?.text).toMatch(/width/)
    }
  })
})

describe("copperflow render", () => {
  const run = async (...args: string[]) => {
    const out: string[] = []
    const err: string[] = []
    const code = await runCli(args, root, { out: (s) => out.push(s), err: (s) => err.push(s) }, { engine: inProcessEngine, renderer: sourceRenderer })
    return { code, out: out.join("\n"), err: err.join("\n") }
  }

  test("writes the PCB beside the circuit and a schematic page under its own name", async () => {
    const pcb = await run("render", "io.circuit.tsx", "--width", "512")
    expect(pcb).toMatchObject({ code: 0, err: "" })
    expect(pcb.out).toMatch(/^Wrote io-pcb\.png \(512 x \d+ px\): PCB, whole board 20 x 10 mm$/)
    expect((await readFile(join(root, "io-pcb.png"))).subarray(1, 4).toString()).toBe("PNG")
    const sheet = await run("render", "io.circuit.tsx", "--view", "schematic", "--out", "pics/sheet.png", "--parts", "R1")
    expect(sheet.out).toMatch(/^Wrote pics\/sheet\.png \(1024 x \d+ px\): Schematic page "Main", around R1$/)
    expect((await stat(join(root, "pics", "sheet.png"))).size).toBeGreaterThan(0)
    const page = await run("render", "io.circuit.tsx", "--view", "schematic")
    expect(page.out).toMatch(/^Wrote io-schematic-Main\.png /)
  })

  test("refuses an --out outside the project and writes nothing", async () => {
    const result = await run("render", "io.circuit.tsx", "--out", "../outside.png")
    expect(result.code).toBe(1)
    expect(result.err).toBe("copperflow: ../outside.png is outside the project root")
    await expect(stat(join(root, "..", "outside.png"))).rejects.toThrow()
  })
})

describe("without the canvas package", () => {
  test("says how to install it", async () => {
    const notFound = Object.assign(new Error("Cannot find package '@napi-rs/canvas' imported from render.js"), { code: "ERR_MODULE_NOT_FOUND" })
    const renderer = () => Promise.reject(notFound)
    const root = await mkdtemp(join(tmpdir(), "cf-render-missing-"))
    try {
      await writeFile(join(root, "io.circuit.tsx"), BOARD)
      await expect(renderCircuit(root, "io.circuit.tsx", { view: "pcb" }, { engine: inProcessEngine, renderer })).rejects.toThrow(CANVAS_MISSING)
      expect(CANVAS_MISSING).toBe("Rendering needs the optional package @napi-rs/canvas, which is not installed here. Install it (npm install -g @napi-rs/canvas) and try again.")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
