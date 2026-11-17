import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { editCircuit, createCircuitFile } from "../src/core/workspace.js"
import type { DesignBuilder } from "../src/studio/live.js"
import type { Studio } from "../src/studio/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { retryLostConnect, startReachableStudio } from "./helpers/reachable-studio.js"

const BOARD = `export default () => (
  <board width="20mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-4} pcbY={0} schX={0} schY={0} />
    <capacitor name="C1" capacitance="1uF" footprint="0603" pcbX={4} pcbY={0} schX={3} schY={0} />
  </board>
)
`
const FILE = "io.circuit.tsx"
let root: string
let studio: Studio
let fileBuilds = 0
const builder: DesignBuilder & { buildFiles(files: Record<string, string>, main: string): ReturnType<typeof inProcessEngine.buildFiles> } = {
  build: (projectRoot, file) => inProcessEngine.build(projectRoot, file),
  buildFiles: (files, main) => {
    fileBuilds += 1
    return inProcessEngine.buildFiles(files, main)
  },
}

const get = async (path: string) => {
  const response = await retryLostConnect(() => fetch(`${studio.url}${path}`, { headers: { "x-copperflow-token": studio.token } }))
  return (await response.json()) as { ok: boolean; data?: any; error?: string }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-studio-change-"))
  const staticDir = join(root, "static")
  await mkdir(staticDir)
  await writeFile(join(staticDir, "index.html"), "<html></html>")
  await createCircuitFile(root, FILE, BOARD, { author: "human", summary: "create io.circuit.tsx" }) // c0001
  await editCircuit(root, FILE, [{ kind: "setProps", part: "R1", props: { pcbX: -6 } }], { author: "ai", summary: "set R1 pcbX=-6" }) // c0002
  await editCircuit(root, FILE, [{ kind: "setProps", part: "R1", props: { schX: 2 } }], { author: "ai", summary: "set R1 schX=2" }) // c0003
  studio = await startReachableStudio({ root, staticDir, builder, routeWorker: null, placeWorker: null })
})

afterAll(async () => {
  await studio.close()
  await rm(root, { recursive: true, force: true })
})

describe("the Studio's change view", () => {
  test("one change: its title and lines, both designs and what changed, built on request (two builds)", async () => {
    fileBuilds = 0
    const answer = await get("/api/change?id=c0002")
    expect(answer.ok).toBe(true)
    expect(fileBuilds).toBe(2)
    const view = answer.data
    expect(view.title).toBe("Change c0002 by the agent: set R1 pcbX=-6")
    expect(view.lines.map((line: { text: string }) => line.text)).toEqual(["Moved 1 part: R1"])
    expect(view.lines[0].at).toEqual({ x: -6, y: 0 })
    expect(view.file).toBe(FILE)
    expect(view.onBoard).toBe(true)
    expect(view.before.pcb.parts.find((part: { component: string }) => part.component === "R1").x).toBe(-4)
    expect(view.after.pcb.parts.find((part: { component: string }) => part.component === "R1").x).toBe(-6)
    expect(view.diff.parts.moved).toHaveLength(1)
  })

  test("a change to the schematic only says so", async () => {
    const view = (await get("/api/change?id=c0003")).data
    expect(view.onBoard).toBe(false)
    expect(view.lines.map((line: { text: string }) => line.text)).toEqual(["Nothing on the board changed", "Schematic: 1 symbol moved (R1)"])
  })

  test("since a change, and an unknown id refused by name", async () => {
    const since = (await get("/api/change?since=c0001")).data
    expect(since.title).toBe("Since c0001: 2 changes, c0002 to c0003 (2 by the agent)")
    const missing = await get("/api/change?id=c0042")
    expect(missing).toMatchObject({ ok: false, error: "No change c0042 in the history" })
    expect((await get("/api/change")).ok).toBe(false)
  })

  test("listing the history builds nothing", async () => {
    fileBuilds = 0
    expect((await get("/api/history")).ok).toBe(true)
    expect(fileBuilds).toBe(0)
  })
})
