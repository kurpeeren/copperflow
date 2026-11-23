// A reference image through MCP: import_graphic with layer "reference" adds, aligns and removes it, and render
// { reference: true } draws it under the PCB, where no export reaches it.
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCanvas, loadImage } from "@napi-rs/canvas"
import { createCopperflowServer } from "../src/mcp/server.js"
import { runCli } from "../src/cli-commands.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const sourceRenderer = () => import("../studio/src/render/node-render.js")
const FILE = "main.circuit.tsx"
const CIRCUIT = `export default () => (
  <board width={40} height={20}>
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-10} pcbY={-6} />
  </board>
)
`

/** A 200 x 100 photo: green on its left half, magenta on its right. */
async function photo(): Promise<Buffer> {
  const canvas = createCanvas(200, 100)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#00ff00"
  ctx.fillRect(0, 0, 100, 100)
  ctx.fillStyle = "#ff00ff"
  ctx.fillRect(100, 0, 100, 100)
  return canvas.encode("png")
}

let root: string
let client: Client

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-mcp-reference-"))
  await writeFile(join(root, FILE), CIRCUIT)
  await mkdir(join(root, "photos"))
  await writeFile(join(root, "photos", "top.png"), await photo())
  const server = createCopperflowServer(root, { engine: inProcessEngine as never, renderer: sourceRenderer })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

afterEach(async () => {
  await client.close()
  await rm(root, { recursive: true, force: true })
})

const text = (result: Awaited<ReturnType<Client["callTool"]>>) => (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n")
const call = async (args: Record<string, unknown>) => client.callTool({ name: "import_graphic", arguments: { file: FILE, layer: "reference", ...args } })

/** The colour of the rendered picture at a pixel. */
async function colourAt(png: string, x: number, y: number): Promise<number[]> {
  const image = await loadImage(Buffer.from(png, "base64"))
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext("2d")
  ctx.drawImage(image, 0, 0)
  return [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)]
}

describe("import_graphic with layer reference", () => {
  test("adds, aligns, renders under the PCB and removes a photo", async () => {
    const added = text(await call({ source: "photos/top.png" }))
    expect(added).toMatch(/added reference image r1 \(references\/top.png, 200 x 100 px\), 50% opaque\./)
    // The photo's middle line on the board's middle line: its left half over x < 0.
    const aligned = text(await call({ reference: { id: "r1", opacity: 1, points: [[0, 50, -20, 0], [200, 50, 20, 0]] } }))
    expect(aligned).toMatch(/2 points: scaled, turned and moved onto the points\./)
    expect(aligned).toMatch(/#1 0 mm, #2 0 mm/)
    const rendered = await client.callTool({ name: "render", arguments: { file: FILE, reference: true, width: 400 } })
    const [image, line] = rendered.content as Array<{ data?: string; text?: string }>
    expect(line?.text).toMatch(/; under it reference r1 \(2 points\); 400 x \d+ px$/)
    const height = Number(/400 x (\d+) px/.exec(line?.text ?? "")?.[1])
    const [left, right] = [await colourAt(image?.data ?? "", 120, height / 2), await colourAt(image?.data ?? "", 280, height / 2)]
    expect(left[1]).toBeGreaterThan(200)
    expect(right[0]).toBeGreaterThan(200)
    expect(right[1]).toBeLessThan(60)
    const removed = text(await call({ reference: { id: "r1", remove: true } }))
    expect(removed).toMatch(/removed reference image r1/)
    const after = await client.callTool({ name: "render", arguments: { file: FILE, reference: true, width: 400 } })
    expect((after.content as Array<{ text?: string }>)[1]?.text).toMatch(/no reference image/)
  })

  test("a hidden reference is not drawn, and a missing image is named", async () => {
    await call({ source: "photos/top.png", reference: { shown: false } })
    const hidden = await client.callTool({ name: "render", arguments: { file: FILE, reference: true } })
    expect((hidden.content as Array<{ text?: string }>)[1]?.text).toMatch(/every reference image is hidden/)
    await call({ reference: { id: "r1", shown: true } })
    await rm(join(root, "references", "top.png"))
    const missing = await client.callTool({ name: "render", arguments: { file: FILE, reference: true } })
    expect((missing.content as Array<{ text?: string }>)[1]?.text).toMatch(/r1's references\/top.png is missing/)
  })

  test("the CLI's render draws it with --reference", async () => {
    await call({ source: "photos/top.png" })
    const out: string[] = []
    const code = await runCli(["render", FILE, "--reference", "--out", "pics/ref.png"], root, { out: (s) => out.push(s), err: (s) => out.push(s) }, { engine: inProcessEngine, renderer: sourceRenderer })
    expect(code).toBe(0)
    expect(out.join(" ")).toMatch(/^Wrote pics\/ref.png \(\d+ x \d+ px\): PCB, whole board 40 x 20 mm; under it reference r1 \(0 points\)$/)
  })

  test("the layout file holds it and no export carries it", async () => {
    await call({ source: "photos/top.png" })
    expect(await readFile(join(root, "main.circuit.layout.json"), "utf8")).toContain('"t":"reference"')
    const exported = await client.callTool({ name: "export_fabrication", arguments: { file: FILE } })
    expect(text(exported)).not.toMatch(/reference/i)
  })

  test("wrong settings are refused with what they take", async () => {
    const refused = async (args: Record<string, unknown>) => {
      const result = await call(args)
      expect(result.isError).toBe(true)
      return text(result)
    }
    expect(await refused({})).toMatch(/give source, the image or Gerber file/)
    expect(await refused({ source: "photos/top.png", reference: { colour: "red" } })).toMatch(/reference: Unrecognized key.*it takes \{ id\?, points\?/)
    expect(await refused({ source: "photos/top.png", reference: { points: [[1, 2, 3]] } })).toMatch(/reference\.points\.0/)
    expect(await refused({ source: "photos/top.png", x: 3 })).toMatch(/x is for a drawing; a reference image is placed by reference\.points/)
    expect(await refused({ reference: { remove: true } })).toMatch(/reference\.remove needs reference\.id/)
    expect(await refused({ source: "photos/top.png", reference: { id: "r1" } })).toMatch(/not both/)
    expect(await refused({ reference: { id: "r1" } })).toMatch(/say what to change/)
    expect(text(await client.callTool({ name: "import_graphic", arguments: { file: FILE, layer: "top-silkscreen", source: "photos/top.png", reference: {} } }))).toMatch(/reference is for layer reference/)
    expect(text(await client.callTool({ name: "import_graphic", arguments: { file: FILE, layer: "top-silkscreen" } }))).toMatch(/give source, the drawing/)
    const board = await client.callTool({ name: "render", arguments: { file: FILE, view: "board", reference: true } })
    expect(text(board)).toMatch(/reference is for view pcb only/)
  })
})
