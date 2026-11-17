import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCanvas, loadImage } from "@napi-rs/canvas"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { runCli } from "../src/cli-commands.js"
import { changeCaption } from "../src/core/change-render.js"
import { buildDesign, type Design } from "../src/engine/design.js"
import { diffDesigns } from "../src/engine/design-diff.js"
import { createCircuitFile } from "../src/core/workspace.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { CHANGE_LOOK } from "../studio/src/pcb/change-draw.js"
import { PALETTE } from "../studio/src/pcb/ctx.js"
import { worldToScreen, type Point } from "../studio/src/pcb/geometry.js"
import { cameraFor, frameFor, imageSize } from "../studio/src/render/render-frame.js"
import { renderDesign } from "../studio/src/render/node-render.js"
import { contrastRatio } from "../studio/src/shell/contrast.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const circuit = (body: string) => `export default () => (
  <board width="30mm" height="20mm">
${body}
  </board>
)
`
const BEFORE = `
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-10} pcbY={5} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={10} pcbY={5} />
    <capacitor name="C1" capacitance="1uF" footprint="0805" pcbX={-10} pcbY={-6} />`
const AFTER = `
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={5} />
    <capacitor name="C1" capacitance="1uF" footprint="0805" pcbX={-10} pcbY={-6} />`
const TRACK = `{"t":"track","id":"t0001","layer":"top","width":0.5,"points":[{"x":0,"y":-8},{"x":12,"y":-8}],"locked":false,"by":"human"}\n`

const before = buildDesign({ "a.circuit.tsx": circuit(BEFORE) }, "a.circuit.tsx")
const after = buildDesign({ "a.circuit.tsx": circuit(AFTER), "a.circuit.layout.json": TRACK }, "a.circuit.tsx")
const diff = diffDesigns({ design: before }, { design: after })

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`

/** How many pixels of `colour` lie within `reach` pixels of the world point. */
async function pixelsNear(png: Uint8Array, design: Design, width: number, world: Point, colour: string, reach = 6): Promise<number> {
  const frame = frameFor(design, { view: "pcb" })
  const size = imageSize(frame.box, width)
  const at = worldToScreen(cameraFor(frame.box, size), size, world)
  const image = await loadImage(Buffer.from(png))
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext("2d")
  ctx.drawImage(image, 0, 0)
  const data = ctx.getImageData(Math.round(at.x) - reach, Math.round(at.y) - reach, 2 * reach + 1, 2 * reach + 1).data
  let count = 0
  for (let i = 0; i < data.length; i += 4) if (hex(data[i] as number, data[i + 1] as number, data[i + 2] as number) === colour.toLowerCase()) count += 1
  return count
}

describe("a change drawn on the board", () => {
  test("the marks' colours read on the board's black and apart from each other; each has its own line style", () => {
    for (const mark of [CHANGE_LOOK.added, CHANGE_LOOK.removed, CHANGE_LOOK.moved]) expect(contrastRatio(mark.colour, PALETTE.background)).toBeGreaterThanOrEqual(3)
    // Cyan against orange: a pair people who do not see red against green tell apart, and the brightness differs too.
    expect(contrastRatio(CHANGE_LOOK.added.colour, CHANGE_LOOK.removed.colour)).toBeGreaterThanOrEqual(1.5)
    expect(contrastRatio(CHANGE_LOOK.moved.colour, CHANGE_LOOK.removed.colour)).toBeGreaterThanOrEqual(1.5)
    const styles = [CHANGE_LOOK.added.dash, CHANGE_LOOK.removed.dash, CHANGE_LOOK.moved.dash].map((dash) => dash.join(","))
    expect(new Set(styles).size).toBe(3)
  })

  test("the added track, the removed part and the moved part are each in their colour where they are", async () => {
    expect(diff.tracks.added.map((one) => one.id)).toEqual(["t0001"])
    expect(diff.parts.removed.map((one) => one.name)).toEqual(["R2"])
    expect(diff.parts.moved.map((one) => one.name)).toEqual(["R1"])
    const rendered = await renderDesign(after, { view: "pcb", width: 900, change: { diff, caption: "c" } })
    expect(await pixelsNear(rendered.png, after, 900, { x: 6, y: -8 }, CHANGE_LOOK.added.colour)).toBeGreaterThan(0)
    const removed = diff.parts.removed[0]!
    const corner = removed.courtyard.reduce((a, b) => (a.x + a.y < b.x + b.y ? a : b))
    expect(await pixelsNear(rendered.png, after, 900, corner, CHANGE_LOOK.removed.colour, 4)).toBeGreaterThan(0)
    // Halfway along the arrow from R1's old place to its new one.
    expect(await pixelsNear(rendered.png, after, 900, { x: -5, y: 5 }, CHANGE_LOOK.moved.colour, 3)).toBeGreaterThan(0)
    // Without the change nothing is drawn in those colours there.
    const plain = await renderDesign(after, { view: "pcb", width: 900 })
    expect(await pixelsNear(plain.png, after, 900, { x: 6, y: -8 }, CHANGE_LOOK.added.colour)).toBe(0)
    expect(rendered.what).toBe("PCB, whole board 30 x 20 mm; c")
  })

  test("the caption says what is marked and how", () => {
    expect(changeCaption("change c0004", diff)).toBe(
      "change c0004 on the board after it: 1 part removed, 1 part moved, 1 track added; added is solid cyan, removed dashed orange, moved a dotted white outline with an arrow to the new place",
    )
    expect(changeCaption("change c0004", diffDesigns({ design: before }, { design: before }))).toBe("change c0004 on the board after it: nothing on the board changed")
  })
})

describe("render with change or since", () => {
  const BOARD = circuit(`
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-4} pcbY={0} />
    <capacitor name="C1" capacitance="1uF" footprint="0603" pcbX={4} pcbY={0} />
    <trace from=".R1 > .pin2" to=".C1 > .pin1" />`)
  let root: string
  let client: Client
  const sourceRenderer = () => import("../studio/src/render/node-render.js")
  const call = (args: Record<string, unknown>) => client.callTool({ name: "render", arguments: { file: "io.circuit.tsx", width: 400, ...args } })
  const text = (result: Awaited<ReturnType<typeof call>>) => (result.content as Array<{ type: string; text?: string }>).find((one) => one.type === "text")?.text

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "cf-change-render-"))
    const server = createCopperflowServer(root, { engine: inProcessEngine, renderer: sourceRenderer })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: "test", version: "0.0.0" })
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
    await createCircuitFile(root, "io.circuit.tsx", BOARD, { author: "human", summary: "create" })
    await client.callTool({ name: "set_props", arguments: { file: "io.circuit.tsx", part: "R1", props: { pcbX: -6 } } })
    await client.callTool({ name: "autoroute", arguments: { file: "io.circuit.tsx" } })
  }, 120_000)

  afterAll(async () => {
    await client.close()
    await rm(root, { recursive: true, force: true })
  })

  test("the line beside the picture says which change is drawn and what it shows", async () => {
    const one = await call({ change: "c0002" })
    expect(one.isError).not.toBe(true)
    expect(text(one)).toMatch(/^io\.circuit\.tsx: PCB, whole board 30 x 20 mm; change c0002 on the board after it: 1 part moved; added is solid cyan.*; 400 x \d+ px$/)
    const since = await call({ since: "c0001" })
    expect(text(since)).toMatch(/; changes after c0001 on the board after them: 1 part moved, 1 track added; added/)
  })

  test("a change and since together, or a change to another circuit's board, is refused", async () => {
    const both = await call({ change: "c0002", since: "c0001" })
    expect(both.isError).toBe(true)
    expect(text(both)).toBe("Give change or since, not both")
    const view = await call({ change: "c0002", view: "schematic" })
    expect(text(view)).toBe("A change is drawn on the PCB only")
  })

  test("the CLI writes the picture and says the same", async () => {
    const out: string[] = []
    const code = await runCli(["render", "io.circuit.tsx", "--change", "c0002", "--out", "moved.png"], root, { out: (s) => out.push(s), err: (s) => out.push(s) }, { engine: inProcessEngine, renderer: sourceRenderer })
    expect(code).toBe(0)
    expect(out[0]).toMatch(/^Wrote moved\.png \(1024 x \d+ px\): PCB, whole board 30 x 20 mm; change c0002 on the board after it: 1 part moved;/)
    expect((await readFile(join(root, "moved.png"))).length).toBeGreaterThan(1000)
  })
})
