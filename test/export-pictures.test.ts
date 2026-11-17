// The export's pictures of the board as made: each side in the folder and the zip, 1600 px on the long side; without
// the canvas package the export still writes everything else and says in one line how to get them.
import { readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { loadImage } from "@napi-rs/canvas"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { exportFabrication, formatFabrication } from "../src/core/fabrication.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { shortTempDir } from "./helpers/short-temp.js"
import { readZip } from "./helpers/zip-read.js"
import { exportPictures } from "../src/engine/fab/picture/png.js"
import { board } from "./helpers/fab-board.js"

const BOARD = `export default () => (
  <board width="20mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0603" supplierPartNumbers={{ jlcpcb: ["C21190"] }} pcbX={-4} pcbY={0} schX={0} schY={0} />
  </board>
)
`
const MISSING = "The board pictures (led-top.png, led-bottom.png) were left out: drawing them needs the optional package @napi-rs/canvas (npm install -g @napi-rs/canvas), then export again."

let root: string
beforeEach(async () => {
  root = await shortTempDir("cf-export-pictures-")
  await writeFile(join(root, "led.circuit.tsx"), BOARD)
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("the export's board pictures", () => {
  test("writes the top and the bottom, 1600 px on the long side, into the folder and the zip", async () => {
    const result = await exportFabrication(root, "led.circuit.tsx", { engine: inProcessEngine })
    if (!result.written) throw new Error(result.errors.join("\n"))
    expect(result.files.slice(-2)).toEqual(["led-top.png", "led-bottom.png"])
    for (const side of ["top", "bottom"]) {
      const image = await loadImage(await readFile(join(root, "led-fab", `led-${side}.png`)))
      expect([image.width, image.height]).toEqual([1600, 800])
    }
    const zipped = readZip(new Uint8Array(await readFile(join(root, "led-fab.zip"))))
    expect(zipped.map((entry) => entry.name).slice(-2)).toEqual(["led-top.png", "led-bottom.png"])
    expect(result.warnings).not.toContain(MISSING)
  })

  test("without the canvas package: everything else is written, one line says how to get them, old ones are removed", async () => {
    await exportFabrication(root, "led.circuit.tsx", { engine: inProcessEngine })
    const notFound = Object.assign(new Error("Cannot find package '@napi-rs/canvas'"), { code: "ERR_MODULE_NOT_FOUND" })
    const result = await exportFabrication(root, "led.circuit.tsx", { engine: inProcessEngine, canvas: () => Promise.reject(notFound) })
    if (!result.written) throw new Error(result.errors.join("\n"))
    expect(result.files).toHaveLength(14)
    expect(result.files.some((file) => file.endsWith(".png"))).toBe(false)
    expect(result.warnings).toContain(MISSING)
    expect(formatFabrication(result)).toContain(`\nWarning: ${MISSING}\n`)
    await expect(readFile(join(root, "led-fab", "led-top.png"))).rejects.toThrow()
    expect(readZip(new Uint8Array(await readFile(join(root, "led-fab.zip")))).some((entry) => entry.name.endsWith(".png"))).toBe(false)
  })

  test("a board without an outline has no pictures; another failure of the canvas package is not hidden", async () => {
    const bare = board({}).board
    const design = { pcb: board({ board: { ...(bare as NonNullable<typeof bare>), outline: [] } }), rules: { fabrication: {} } } as unknown as Parameters<typeof exportPictures>[0]
    expect(await exportPictures(design)).toEqual([])
    const broken = () => Promise.reject(new Error("out of memory"))
    await expect(exportPictures({ ...design, pcb: board({}) }, broken)).rejects.toThrow("out of memory")
  })
})
