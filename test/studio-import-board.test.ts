import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readEntries } from "../src/core/history.js"
import { resolveCircuit } from "../src/core/workspace.js"
import { buildDesign } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import type { DesignBuilder } from "../src/studio/live.js"
import type { Studio } from "../src/studio/server.js"
import { blocksRequest, lockedOff, AI_LOCK_MESSAGE } from "../studio/src/ai-lock.js"
import { MENUS, menuItems } from "../studio/src/shell/menus.js"
import { retryLostConnect, startReachableStudio } from "./helpers/reachable-studio.js"

const FILE = "main.circuit.tsx"
const SOURCE = `export default () => (
  <board width="40mm" height="30mm">
    <resistor name="R1" resistance="10k" footprint="0603" pcbX={0} pcbY={0} />
  </board>
)
`
const builder: DesignBuilder = {
  build: async (root, file) => buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), (await resolveCircuit(root, file)).file),
}
const DRAWING = new URL("./fixtures/dxf/rectangle-holes.dxf", import.meta.url)

let root: string
let studio: Studio

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-studio-board-"))
  await mkdir(join(root, "static"))
  await writeFile(join(root, "static", "index.html"), "<html></html>")
  await writeFile(join(root, FILE), SOURCE)
  studio = await startReachableStudio({ root, staticDir: join(root, "static"), builder, routeWorker: null, placeWorker: null })
})

afterEach(async () => {
  await studio.close()
})

const api = (path: string, body: unknown) =>
  retryLostConnect(() =>
    fetch(`${studio.url}${path}`, {
      method: "POST",
      headers: { "x-copperflow-token": studio.token, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )

describe("File → Import board outline (DXF)", () => {
  test("is in the File menu and off while the AI lock is closed, as its request is", () => {
    const file = MENUS.find((menu) => menu.title === "File")
    expect(menuItems(file!).find((item) => item.command === "importBoardDxf")?.label).toBe("Import board (DXF or KiCad)…")
    expect(lockedOff(true).importBoardDxf).toBe(AI_LOCK_MESSAGE)
    expect(blocksRequest("/api/import-board", { file: FILE, name: "a.dxf", text: "" })).toBe(true)
  })

  test("POST /api/import-board writes the drawing's board as one human entry and answers its first line", async () => {
    const text = await readFile(DRAWING, "utf8")
    const response = await api("/api/import-board", { file: FILE, name: "enclosure.dxf", text })
    const json = (await response.json()) as { ok: boolean; data: { summary: string } }
    expect(json.ok).toBe(true)
    expect(json.data.summary).toMatch(/^Change c\d+: board outline from enclosure\.dxf: 4 corners, 82 x 54 mm \(drawing in mm, moved by -41, -27\)$/)
    const entries = await readEntries(root)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ author: "human", summary: "board outline from enclosure.dxf" })
    expect(await readFile(join(root, FILE), "utf8")).toContain("<hole x={37} y={23} diameter={3.2} />")
  })

  test("a refusal answers the reason and writes nothing", async () => {
    const response = await api("/api/import-board", { file: FILE, name: "notes.dxf", text: "hello" })
    const json = (await response.json()) as { ok: boolean; error: string }
    expect(json.ok).toBe(false)
    expect(json.error).toBe("notes.dxf: The file is not an ASCII DXF: it has no group codes")
    expect(await readEntries(root)).toEqual([])
    expect(await readFile(join(root, FILE), "utf8")).toBe(SOURCE)
  })

  test("a KiCad board picked there becomes a new circuit, as one human entry, and the answer names it", async () => {
    const text = await readFile(new URL("./fixtures/kicad/fixture.kicad_pcb", import.meta.url), "utf8")
    const response = await api("/api/import-board", { file: FILE, name: "fixture.kicad_pcb", text })
    const json = (await response.json()) as { ok: boolean; data: { summary: string; file: string } }
    expect(json.ok).toBe(true)
    expect(json.data.file).toBe("fixture.circuit.tsx")
    expect(json.data.summary.split("\n")[0]).toMatch(/^Change c\d+: imported fixture\.kicad_pcb \(KiCad file version 20260206\) as fixture\.circuit\.tsx/)
    expect(json.data.summary).toContain("Pads: all 49 copper pads have the net they had in the file")
    expect(await readEntries(root)).toHaveLength(1)
    expect(await readFile(join(root, FILE), "utf8")).toBe(SOURCE)
    const again = (await (await api("/api/import-board", { file: FILE, name: "fixture.kicad_pcb", text })).json()) as { ok: boolean; error: string }
    expect(again).toMatchObject({ ok: false, error: "fixture.circuit.tsx already exists; remove it or rename the board file first" })
  })
})
