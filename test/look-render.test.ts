// render's view "3d": the board as made with its parts as lit simple shapes, through the MCP tool and the CLI: its line
// of text, each angle, the look, the size limit and the refusals.
import { readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { loadImage } from "@napi-rs/canvas"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { runCli } from "../src/cli-commands.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { shortTempDir } from "./helpers/short-temp.js"

const BOARD = `export default () => (
  <board width="20mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-4} pcbY={0} schX={0} schY={0} />
    <chip name="U1" footprint="soic8" pcbX={4} pcbY={0} schX={3} schY={0} />
  </board>
)
`
const renderer = () => import("../studio/src/render/node-render.js")
let root: string
let client: Client

beforeEach(async () => {
  root = await shortTempDir("cf-look-")
  await writeFile(join(root, "io.circuit.tsx"), BOARD)
  const server = createCopperflowServer(root, { engine: inProcessEngine, renderer })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

afterEach(async () => {
  await client.close()
  await rm(root, { recursive: true, force: true })
})

const call = async (args: Record<string, unknown>) => {
  const result = await client.callTool({ name: "render", arguments: { file: "io.circuit.tsx", view: "3d", ...args } })
  return { result, content: result.content as Array<{ type: string; data?: string; text?: string }> }
}

describe("render with view 3d", () => {
  test("draws the iso view by default, and its line says what it shows and what it is not", async () => {
    const { result, content } = await call({ width: 400 })
    expect(result.isError).not.toBe(true)
    expect(content[1]?.text).toBe(
      "io: 3D from iso, the board as made (green mask, ENIG) and 2 parts as simple shapes, not their real models; heights typical: R1; none assumed; 400 x 272 px",
    )
    const image = await loadImage(Buffer.from(content[0]!.data!, "base64"))
    expect([image.width, image.height]).toEqual([400, 272])
  })

  test("each angle, and the look by the picture's names", async () => {
    for (const angle of ["top", "bottom", "front", "iso"]) {
      const { content } = await call({ width: 320, angle, look: { mask: "black", finish: "hasl" } })
      expect(content[1]?.text).toContain(`3D from ${angle}, the board as made (black mask, HASL)`)
    }
  })

  test("refuses a size over its limit, an angle for another view and a side for 3d", async () => {
    expect((await call({ width: 2400 })).content[0]?.text).toBe("width must be a whole number of pixels from 320 to 2000 for view 3d")
    const angle = await client.callTool({ name: "render", arguments: { file: "io.circuit.tsx", view: "board", angle: "iso" } })
    expect((angle.content as Array<{ text: string }>)[0]?.text).toBe("angle is for view 3d only")
    expect((await call({ side: "bottom" })).content[0]?.text).toBe("side is for view board only; view 3d takes angle")
  })

  test("copperflow render --view 3d --angle top writes <name>-3d-top.png", async () => {
    const out: string[] = []
    const code = await runCli(["render", "io.circuit.tsx", "--view", "3d", "--angle", "top", "--width", "320"], root, { out: (t) => out.push(t), err: (t) => out.push(t) }, { engine: inProcessEngine, renderer })
    expect(code).toBe(0)
    expect(out.join("\n")).toMatch(/^Wrote io-3d-top\.png \(320 x 218 px\): 3D from top, /)
    expect((await readFile(join(root, "io-3d-top.png"))).length).toBeGreaterThan(1000)
  })
})
