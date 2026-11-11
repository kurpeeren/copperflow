import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveCircuit } from "../src/core/workspace.js"
import { buildDesign } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import type { DesignBuilder } from "../src/studio/live.js"
import type { Studio } from "../src/studio/server.js"
import { newCircuitRequest } from "../studio/src/shell/new-circuit-form.js"
import { retryLostConnect, startReachableStudio } from "./helpers/reachable-studio.js"

const builder: DesignBuilder = {
  build: async (root, file) => buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), (await resolveCircuit(root, file)).file),
}
let root: string
let studio: Studio

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-new-circuit-"))
  const staticDir = join(root, "static")
  await mkdir(staticDir)
  await writeFile(join(staticDir, "index.html"), "<html></html>")
  studio = await startReachableStudio({ root, staticDir, builder })
})

afterEach(() => studio.close())

async function post(path: string, body: unknown) {
  const response = await retryLostConnect(() =>
    fetch(`${studio.url}${path}`, { method: "POST", headers: { "x-copperflow-token": studio.token, "content-type": "application/json" }, body: JSON.stringify(body) }),
  )
  return (await response.json()) as { ok: boolean; data?: any; error?: string }
}

describe("File → New circuit…", () => {
  test("the dialog's fields become the request: the name with .circuit.tsx, the board in mm", () => {
    expect(newCircuitRequest(" power ", "40", "25")).toEqual({ file: "power.circuit.tsx", width: 40, height: 25 })
    expect(newCircuitRequest("boards/led.circuit.tsx", "30", "20")).toEqual({ file: "boards/led.circuit.tsx", width: 30, height: 20 })
    expect(newCircuitRequest("", "30", "20")).toEqual({ message: "Give the circuit a name" })
    expect(newCircuitRequest("../up", "30", "20")).toHaveProperty("message")
    expect(newCircuitRequest("ok", "0", "20")).toHaveProperty("message")
  })

  test("the server writes an empty circuit through the core as one history entry, and refuses an existing file", async () => {
    const made = await post("/api/new-circuit", { file: "power.circuit.tsx", width: 40, height: 25 })
    expect(made.ok).toBe(true)
    expect(made.data.file).toBe("power.circuit.tsx")
    const text = await readFile(join(root, "power.circuit.tsx"), "utf8")
    expect(text).toContain('<board width="40mm" height="25mm">')
    const again = await post("/api/new-circuit", { file: "power.circuit.tsx", width: 40, height: 25 })
    expect(again.ok).toBe(false)
    expect(again.error).toContain("already exists")
    const undone = await post("/api/undo", {})
    expect(undone.ok).toBe(true)
    await expect(readFile(join(root, "power.circuit.tsx"), "utf8")).rejects.toThrow()
  })

  test("refuses a name outside the project", async () => {
    const outside = await post("/api/new-circuit", { file: "../x.circuit.tsx", width: 10, height: 10 })
    expect(outside.ok).toBe(false)
  })
})
