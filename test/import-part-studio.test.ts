// Library → Import by LCSC number…: the Studio route, with fetches answered from copperflow's own fixtures.
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Studio } from "../src/studio/server.js"
import { BOARD, SHARED } from "./fixtures.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { fixtureFetch, offlineFetch } from "./helpers/lcsc-fixtures.js"
import { retryLostConnect, startReachableStudio } from "./helpers/reachable-studio.js"

let root: string
let studio: Studio | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-import-studio-"))
  await mkdir(join(root, "static"))
  await writeFile(join(root, "static", "index.html"), "<html></html>")
  await writeFile(join(root, "main.circuit.tsx"), BOARD)
  await writeFile(join(root, "shared.ts"), SHARED)
})

afterEach(async () => {
  await studio?.close()
  studio = undefined
})

async function open(get: typeof fetch): Promise<Studio> {
  studio = await startReachableStudio({ root, staticDir: join(root, "static"), builder: inProcessEngine, routeWorker: null, fetch: get })
  return studio
}

async function post(server: Studio, path: string, body: unknown): Promise<{ status: number; json: { ok: boolean; data?: any; error?: string } }> {
  const response = await retryLostConnect(() =>
    fetch(`${server.url}${path}`, { method: "POST", headers: { "x-copperflow-token": server.token, "content-type": "application/json" }, body: JSON.stringify(body) }),
  )
  return { status: response.status, json: await response.json() }
}

describe("POST /api/import-part", () => {
  test("imports the part and answers with what it wrote, the notes and the terms; the library lists it unverified", async () => {
    const server = await open(fixtureFetch())
    const { json } = await post(server, "/api/import-part", { lcsc: "C7950" })
    expect(json.ok).toBe(true)
    expect(json.data).toMatchObject({ id: "LM358DR2G", lcsc: "C7950", title: "LM358DR2G, SOIC-8_L4.9-W3.9-P1.27-LS6.0-BL", pins: 8, pads: 8, notes: [] })
    expect(json.data.files).toContain("parts/LM358DR2G/verification.md")
    expect(json.data.terms).toMatch(/personal, non-commercial use only/)
    const parts = await (await retryLostConnect(() => fetch(`${server.url}/api/parts`, { headers: { "x-copperflow-token": server.token } }))).json()
    expect(parts.data.library).toEqual([expect.objectContaining({ id: "LM358DR2G", verified: false, origin: expect.stringMatching(/^lcsc C7950, imported /) })])
  })

  test("an existing id is refused unless replace; offline says so and writes nothing", async () => {
    const server = await open(fixtureFetch())
    await post(server, "/api/import-part", { lcsc: "C158012", id: "XH2" })
    const again = await post(server, "/api/import-part", { lcsc: "C158012", id: "XH2" })
    expect(again.status).toBe(400)
    expect(again.json.error).toContain("Part XH2 already exists")
    expect((await post(server, "/api/import-part", { lcsc: "C158012", id: "XH2", replace: true })).json.ok).toBe(true)
    await server.close()
    studio = undefined
    const cut = await open(offlineFetch)
    const offline = await post(cut, "/api/import-part", { lcsc: "C7950" })
    expect(offline.status).toBe(400)
    expect(offline.json.error).toContain("Importing needs an internet connection; nothing was written.")
    expect(await readdir(join(root, "parts"))).toEqual(["XH2"])
  })
})
