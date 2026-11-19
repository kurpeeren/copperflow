// The 3D model files: copperflow glb and the MCP tool export_model, which writes the STEP file or the GLB file.
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { loadImage, createCanvas } from "@napi-rs/canvas"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { runCli } from "../src/cli-commands.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { pngBytes } from "../studio/src/render/png-bytes.js"
import { imageBytes, readGlb } from "./helpers/glb-read.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { shortTempDir } from "./helpers/short-temp.js"
import { productNames, readStep } from "./helpers/step-read.js"

const CIRCUIT = `export default () => (
  <board width="10mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={0} pcbY={0} schX={0} schY={0} />
    <chip name="U1" pcbX={3} pcbY={3} schX={4} schY={0} />
  </board>
)
`
const WHAT = "the board as made (green mask, ENIG) and 2 parts as simple shapes, not their real models; heights typical: R1; assumed: U1"
const renderer = () => import("../studio/src/render/node-render.js")

let root: string
let out: string[]
let err: string[]
const run = (...args: string[]) => runCli(args, root, { out: (s) => out.push(s), err: (s) => err.push(s) }, { engine: inProcessEngine, renderer })
const exists = (path: string) => stat(join(root, path)).then(
  () => true,
  () => false,
)

/** A PNG's pixels, read back by the canvas package. */
async function pixels(png: Uint8Array) {
  const image = await loadImage(Buffer.from(png))
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext("2d")
  ctx.drawImage(image, 0, 0)
  return { width: image.width, height: image.height, rgba: [...ctx.getImageData(0, 0, image.width, image.height).data] }
}

beforeEach(async () => {
  root = await shortTempDir("cf-model-")
  out = []
  err = []
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("the PNG the model's pictures are written as", () => {
  test("reads back as the same pixels", async () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 255, 0, 0, 0, 0, 200, 100, 50, 255])
    expect(await pixels(pngBytes({ rgba, width: 3, height: 2 }))).toEqual({ width: 3, height: 2, rgba: [...rgba] })
  })

  test("the same picture is the same bytes", () => {
    const rgba = new Uint8ClampedArray(40 * 30 * 4).fill(77)
    expect(pngBytes({ rgba, width: 40, height: 30 })).toEqual(pngBytes({ rgba, width: 40, height: 30 }))
  })
})

describe("copperflow glb", () => {
  test("writes <name>.glb beside the circuit and says what it holds and is not", async () => {
    await mkdir(join(root, "boards"))
    await writeFile(join(root, "boards", "led.circuit.tsx"), CIRCUIT)
    const code = await run("glb", "boards/led.circuit.tsx")
    expect(err).toEqual([])
    expect(code).toBe(0)
    const [first, second, ...more] = out.join("\n").split("\n")
    expect(first).toMatch(/^Wrote boards\/led\.glb \(\d+ kB\): /)
    expect(first!.replace(/^[^:]+: /, "")).toBe(WHAT)
    expect(second).toBe("led.glb is a glTF 2.0 file: a 3D viewer, a 3D editor or a web page opens it and turns it.")
    expect(more).toEqual([])
    const file = readGlb(await readFile(join(root, "boards", "led.glb")))
    expect(file.json.scenes[0]!.name).toBe("led")
    expect(file.json.nodes[0]!.children!.map((child) => file.json.nodes[child]!.name)).toEqual(["board", "R1", "U1"])
  })

  test("the board's pictures in the file are PNGs at the board's size: 40 pixels a millimetre for a small board", async () => {
    await writeFile(join(root, "led.circuit.tsx"), CIRCUIT)
    expect(await run("glb", "led.circuit.tsx")).toBe(0)
    const file = readGlb(await readFile(join(root, "led.glb")))
    const top = file.json.images!.findIndex((image) => image.name === "board top")
    const picture = await pixels(imageBytes(file, top))
    expect(picture.width).toBeGreaterThanOrEqual(400)
    expect(picture.height).toBeGreaterThanOrEqual(400)
    // The middle of the board is under R1: its pad's finish or the mask, never see-through.
    expect(picture.rgba[(Math.floor(picture.height / 4) * picture.width + Math.floor(picture.width / 4)) * 4 + 3]).toBe(255)
  })

  test("--out writes to that file in the project, and a look changes the board: the same design and look write the same bytes", async () => {
    await writeFile(join(root, "led.circuit.tsx"), CIRCUIT)
    expect(await run("glb", "led.circuit.tsx", "--out", "cad/board.glb")).toBe(0)
    const green = await readFile(join(root, "cad", "board.glb"))
    expect(await run("glb", "led.circuit.tsx", "--out", "cad/board.glb")).toBe(0)
    expect((await readFile(join(root, "cad", "board.glb"))).equals(green)).toBe(true)
    expect(await run("glb", "led.circuit.tsx", "--out", "cad/board.glb", "--mask", "black", "--finish", "hasl")).toBe(0)
    expect(out.at(-1)).toMatch(/: the board as made \(black mask, HASL\) and 2 parts/)
    expect((await readFile(join(root, "cad", "board.glb"))).equals(green)).toBe(false)
    expect(await exists("led.glb")).toBe(false)
  })

  test("refuses a file outside the project, one that is not .glb, and a mask there is none of", async () => {
    await writeFile(join(root, "led.circuit.tsx"), CIRCUIT)
    expect(await run("glb", "led.circuit.tsx", "--out", "../board.glb")).toBe(1)
    expect(err.at(-1)).toMatch(/outside the project/)
    expect(await run("glb", "led.circuit.tsx", "--out", "board.step")).toBe(1)
    expect(err.at(-1)).toBe("copperflow: --out takes a file ending in .glb (got board.step)")
    expect(await run("glb", "led.circuit.tsx", "--out", "board.glb:x.glb")).toBe(1)
    expect(err.at(-1)).toMatch(/cannot contain ":"/)
    expect(await run("step", "led.circuit.tsx", "--out", "board.step:x.step")).toBe(1)
    expect(err.at(-1)).toMatch(/cannot contain ":"/)
    expect(await run("glb", "led.circuit.tsx", "--mask", "pink")).toBe(1)
    expect(err.at(-1)).toMatch(/^copperflow: mask must be one of /)
    expect(await exists("led.glb")).toBe(false)
  })

  test("the help names it", async () => {
    expect(await run("--help")).toBe(0)
    expect(out.join("\n")).toMatch(/copperflow glb <file> \[--out file\.glb\]/)
  })
})

describe("export_model", () => {
  let client: Client

  beforeEach(async () => {
    await writeFile(join(root, "led.circuit.tsx"), CIRCUIT)
    const server = createCopperflowServer(root, { engine: inProcessEngine, renderer })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: "test", version: "0.0.0" })
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  })

  afterEach(async () => {
    await client.close()
  })

  async function call(args: Record<string, unknown>) {
    const result = await client.callTool({ name: "export_model", arguments: { file: "led.circuit.tsx", ...args } })
    const content = result.content as Array<{ type: string; text: string }>
    return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
  }

  test("takes the circuit, the format, and optionally a project file and a look, and says it writes files", async () => {
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === "export_model")
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(["file", "format", "out", "look"])
    expect(tool?.inputSchema.required).toEqual(["file", "format"])
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    expect(tool?.description).toMatch(/STEP/)
    expect(tool?.description).toMatch(/GLB/)
  })

  test("format step writes the STEP file, as copperflow step does, for a design that is not finished too", async () => {
    const answer = await call({ format: "step" })
    expect(answer).toEqual({
      isError: false,
      text: [
        "Wrote led.step: the board as a solid and 2 parts as coloured faces.",
        "led.step: parts are the 3D view's shapes as coloured faces (surfaces, not solids), not their real models; heights marked typical come from a package table, assumed ones are guesses (typical: R1; assumed: U1).",
      ].join("\n"),
    })
    expect(productNames(readStep(await readFile(join(root, "led.step"), "utf8")))).toEqual(["led", "board", "R1", "U1"])
  })

  test("format glb writes the GLB file, in a look when one is asked for", async () => {
    const answer = await call({ format: "glb", out: "cad/led.glb", look: { mask: "blue" } })
    expect(answer.isError).toBe(false)
    expect(answer.text.split("\n")[0]).toMatch(/^Wrote cad\/led\.glb \(\d+ kB\): the board as made \(blue mask, ENIG\) and 2 parts as simple shapes/)
    expect(readGlb(await readFile(join(root, "cad", "led.glb"))).json.asset.version).toBe("2.0")
  })

  test("an empty look with format step is no look", async () => {
    expect((await call({ format: "step", look: {} })).isError).toBe(false)
  })

  test("refuses a look for a STEP file, a file of the other kind, and a file outside the project", async () => {
    expect(await call({ format: "step", look: { mask: "blue" } })).toEqual({ isError: true, text: "look is for format glb: a STEP file has no colours of the board as made" })
    expect(await call({ format: "glb", out: "led.step" })).toEqual({ isError: true, text: "out takes a file ending in .glb (got led.step)" })
    expect((await call({ format: "step", out: "../led.step" })).text).toMatch(/outside the project/)
    expect(await exists("led.step")).toBe(false)
    expect(await exists("led.glb")).toBe(false)
  })
})
