// The one-file web page of a design: copperflow html and the MCP tool export_html.
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { runCli } from "../src/cli-commands.js"
import { exportHtml } from "../src/core/html-export.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { shortTempDir } from "./helpers/short-temp.js"
import { readZip } from "./helpers/zip-read.js"

/** Builds and exports without errors: one resistor with its LCSC number. */
const CLEAN = `export default () => (
  <board width="10mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0402" supplierPartNumbers={{ jlcpcb: ["C11702"] }} pcbX={0} pcbY={0} schX={0} schY={0} />
    <capacitor name="C1" capacitance="100nF" footprint="0402" pcbX={3} pcbY={0} schX={3} schY={0} />
    <led name="D1" color="red" footprint="0603" pcbX={-3} pcbY={0} schX={-3} schY={0} />
  </board>
)
`
/** Two parts on top of each other: the export refuses it. */
const BROKEN = `export default () => (
  <board width="10mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={0} pcbY={0} schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" pcbX={0} pcbY={0} schX={3} schY={0} />
    <trace from=".R1 > .pin1" to=".R2 > .pin2" />
  </board>
)
`
const DATE = new Date("2026-03-04T05:06:08Z")
/**
 * The page's seven pictures at the smallest width the renderer takes. Tests that look at what the page holds, not at
 * how big its pictures are, draw them this small: at full size an export takes 20 s or more on a loaded machine
 * under coverage, and two of them in one test came within seconds of the limit.
 */
const SMALL_PICTURES = 320
/** For the tests that do draw and embed every picture at full size, or run two exports back to back, under coverage. */
const LOADED_MACHINE_MS = 300_000
const renderer = () => import("../studio/src/render/node-render.js")

let root: string
let out: string[]
let err: string[]
const run = (...args: string[]) => runCli(args, root, { out: (s) => out.push(s), err: (s) => err.push(s) }, { engine: inProcessEngine, renderer, date: DATE })
/** The page as `copperflow html` writes it, with small pictures; the same engine, renderer and date as `run`. */
const exportSmallPage = (file: string, look?: { mask: "black" }) => exportHtml(root, file, { engine: inProcessEngine, renderer, date: DATE, pictureWidth: SMALL_PICTURES, ...(look ? { look } : {}) })
const exists = (path: string) => stat(join(root, path)).then(
  () => true,
  () => false,
)

/** Each download link of the page: its name, type and bytes. */
function links(html: string): Map<string, { mime: string; bytes: Buffer }> {
  const found = [...html.matchAll(/href="data:([^;"]+);base64,([A-Za-z0-9+/=]*)" download="([^"]+)"/g)]
  return new Map(found.map(([, mime, data, name]) => [name as string, { mime: mime as string, bytes: Buffer.from(data as string, "base64") }]))
}

/** Each picture's width read from its PNG header. */
function pictureWidths(html: string): number[] {
  return [...html.matchAll(/src="data:image\/png;base64,([A-Za-z0-9+/=]+)"/g)].map(([, data]) => {
    const png = Buffer.from(data as string, "base64")
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG")
    return png.readUInt32BE(16)
  })
}

beforeEach(async () => {
  root = await shortTempDir("cf-html-")
  out = []
  err = []
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("copperflow html", () => {
  test("writes <name>.html beside the circuit with the pictures, the BOM and the files inside", async () => {
    await mkdir(join(root, "boards"))
    await writeFile(join(root, "boards", "led.circuit.tsx"), CLEAN)
    expect(await run("html", "boards/led.circuit.tsx")).toBe(0)
    expect(err).toEqual([])
    expect(out.join("\n")).toMatch(/^Wrote boards\/led\.html \(\d+ kB\): the design as one page: 1 schematic page, .*BOM \(3 lines\); files inside: led-fab\.zip, led\.glb, led\.step, led-bom\.csv\n/)
    const html = await readFile(join(root, "boards", "led.html"), "utf8")
    expect(pictureWidths(html)).toEqual([1600, 1600, 1600, 1600, 1200, 1200, 1200])
    expect(html).toContain('<td class="designators">R1</td>')
    expect(html).toMatch(/<span class="file-name">[^<]+-fab\.zip<\/span><span class="file-size">\d+ kB<\/span><span class="file-what">Download the fabrication files \(Gerbers, drills, pick-and-place, BOM, STEP, board pictures\)<\/span>/)
    // The credit line's link is the one address on the page, and it is only followed when a person clicks it.
    expect(html.replaceAll("https://copperflow.kurpeeren.com", "")).not.toMatch(/https?:\/\//)
    // Nothing but the page is left beside the circuit.
    expect((await readdir(join(root, "boards"))).sort()).toEqual(["led.circuit.tsx", "led.html"])
  }, LOADED_MACHINE_MS)

  test("the embedded files are the ones the other commands write", async () => {
    await writeFile(join(root, "led.circuit.tsx"), CLEAN)
    await exportSmallPage("led.circuit.tsx")
    const files = links(await readFile(join(root, "led.html"), "utf8"))
    expect([...files.keys()]).toEqual(["led-fab.zip", "led.glb", "led.step", "led-bom.csv"])
    expect([...files.values()].map((file) => file.mime)).toEqual(["application/zip", "model/gltf-binary", "model/step", "text/csv"])
    expect(await run("export", "led.circuit.tsx")).toBe(0)
    const written = readZip(await readFile(join(root, "led-fab.zip"))).map((entry) => entry.name)
    const embedded = readZip(files.get("led-fab.zip")!.bytes)
    expect(embedded.map((entry) => entry.name)).toEqual(written)
    expect(embedded[0]!.modified).toMatchObject({ year: 2026, month: 3, day: 4 })
    expect(await run("glb", "led.circuit.tsx")).toBe(0)
    expect(files.get("led.glb")!.bytes.subarray(0, 4).toString("latin1")).toBe("glTF")
    expect(files.get("led.glb")!.bytes.equals(await readFile(join(root, "led.glb")))).toBe(true)
    expect(await run("step", "led.circuit.tsx")).toBe(0)
    expect(files.get("led.step")!.bytes.toString("utf8").startsWith("ISO-10303-21")).toBe(true)
    expect(files.get("led.step")!.bytes.equals(await readFile(join(root, "led.step")))).toBe(true)
    expect(await run("bom", "led.circuit.tsx", "--csv")).toBe(0)
    expect(files.get("led-bom.csv")!.bytes.toString("utf8")).toBe(out.at(-1))
  }, LOADED_MACHINE_MS)

  // The page's own determinism is proven picture by picture in html-page.test.ts; this is the one end-to-end check that
  // the whole export (pictures, zip, GLB, STEP, BOM) carries nothing of the run into the bytes. Small pictures keep it
  // to the work that matters: a second full-size export doubled a test that was already the slowest of the file.
  test("the same design, look and date write the same bytes", async () => {
    await writeFile(join(root, "led.circuit.tsx"), CLEAN)
    await exportSmallPage("led.circuit.tsx", { mask: "black" })
    const first = await readFile(join(root, "led.html"))
    expect(first.length).toBeGreaterThan(100_000)
    await exportSmallPage("led.circuit.tsx", { mask: "black" })
    expect((await readFile(join(root, "led.html"))).equals(first)).toBe(true)
    expect(first.toString("utf8")).toContain("2026-03-04")
    expect(links(first.toString("utf8")).size).toBe(4)
  }, LOADED_MACHINE_MS)

  test("a design with errors is still written, without the fabrication files and saying why", async () => {
    await writeFile(join(root, "bad.circuit.tsx"), BROKEN)
    expect(await run("html", "bad.circuit.tsx")).toBe(0)
    expect(out.join("\n")).toContain("no fabrication files: the design has errors")
    const html = await readFile(join(root, "bad.html"), "utf8")
    expect([...links(html).keys()]).toEqual(["bad.glb", "bad.step", "bad-bom.csv"])
    expect(html).toMatch(/No fabrication files: the export refuses this design until its errors are fixed: [^<]+\./)
    expect((await readdir(root)).sort()).toEqual(["bad.circuit.tsx", "bad.html"])
  })

  test("refuses a file outside the project, one that is not .html, and a mask there is none of", async () => {
    await writeFile(join(root, "led.circuit.tsx"), CLEAN)
    expect(await run("html", "led.circuit.tsx", "--out", "../page.html")).toBe(1)
    expect(err.at(-1)).toMatch(/outside the project/)
    expect(await run("html", "led.circuit.tsx", "--out", "page.htm")).toBe(1)
    expect(err.at(-1)).toBe("copperflow: --out takes a file ending in .html (got page.htm)")
    expect(await run("html", "led.circuit.tsx", "--mask", "pink")).toBe(1)
    expect(err.at(-1)).toMatch(/^copperflow: mask must be one of /)
    expect(await exists("led.html")).toBe(false)
  })

  test("the help names it", async () => {
    expect(await run("--help")).toBe(0)
    expect(out.join("\n")).toMatch(/copperflow html <file> \[--out file\.html\]/)
  })

  test("an example: io-8 has every page and stays under 6 MB", async () => {
    await cp(join(import.meta.dirname, "..", "examples", "io-8"), root, { recursive: true })
    expect(await run("html", "io-8.circuit.tsx", "--out", "share/io-8.html")).toBe(0)
    const html = await readFile(join(root, "share", "io-8.html"))
    expect(html.length).toBeLessThan(6_000_000)
    expect((html.toString("utf8").match(/<h3>/g) ?? []).length).toBeGreaterThanOrEqual(1)
  }, LOADED_MACHINE_MS)
})

describe("export_html", () => {
  test("writes the page and answers the CLI's lines", async () => {
    // The client gives up on a request after 60 s by default, which one full-size export outlasts on a loaded machine.
    const patient = { timeout: LOADED_MACHINE_MS }
    await writeFile(join(root, "led.circuit.tsx"), CLEAN)
    const server = createCopperflowServer(root, { engine: inProcessEngine, renderer })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: "test", version: "0.0.0" })
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
    const result = (await client.callTool({ name: "export_html", arguments: { file: "led.circuit.tsx", out: "share/led.html", look: { mask: "blue" } } }, undefined, patient)) as { isError?: boolean; content: { text: string }[] }
    expect(result.isError).toBeFalsy()
    expect(result.content[0]!.text).toMatch(/^Wrote share\/led\.html \(\d+ kB\): the design as one page/)
    expect(await exists("share/led.html")).toBe(true)
    const refused = (await client.callTool({ name: "export_html", arguments: { file: "led.circuit.tsx", out: "led.png" } }, undefined, patient)) as { isError?: boolean; content: { text: string }[] }
    expect(refused.isError).toBe(true)
    await client.close()
  }, LOADED_MACHINE_MS)
})
