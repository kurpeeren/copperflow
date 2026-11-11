// Library → New part…: the Studio route writes the part through the wizard's writer, as create_part does.
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Studio } from "../src/studio/server.js"
import { BOARD, SHARED } from "./fixtures.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { retryLostConnect, startReachableStudio } from "./helpers/reachable-studio.js"

let root: string
let studio: Studio | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-new-part-studio-"))
  await mkdir(join(root, "static"))
  await writeFile(join(root, "static", "index.html"), "<html></html>")
  await writeFile(join(root, "main.circuit.tsx"), BOARD)
  await writeFile(join(root, "shared.ts"), SHARED)
})

afterEach(async () => {
  await studio?.close()
  studio = undefined
})

async function open(): Promise<Studio> {
  studio = await startReachableStudio({ root, staticDir: join(root, "static"), builder: inProcessEngine, routeWorker: null })
  return studio
}

async function post(server: Studio, body: unknown): Promise<{ status: number; json: { ok: boolean; data?: any; error?: string } }> {
  const response = await retryLostConnect(() =>
    fetch(`${server.url}/api/create-part`, { method: "POST", headers: { "x-copperflow-token": server.token, "content-type": "application/json" }, body: JSON.stringify(body) }),
  )
  return { status: response.status, json: await response.json() }
}

const CRYSTAL = {
  id: "X16M",
  title: "16 MHz crystal",
  mpn: "ABLS-16.000MHZ-B4-T",
  package: "hc49s",
  pins: [
    { number: "1", name: "XTAL1", type: "passive" },
    { number: "2", name: "XTAL2", type: "passive" },
  ],
  suppliers: { lcsc: "C16212" },
  datasheet: { url: "https://abracon.com/Resonators/abls.pdf" },
}

describe("POST /api/create-part", () => {
  test("writes the part and answers with the files, the checklist and its path; the library lists it unverified and written", async () => {
    const server = await open()
    const { json } = await post(server, CRYSTAL)
    expect(json.ok).toBe(true)
    expect(json.data).toMatchObject({ id: "X16M", title: "16 MHz crystal", pins: 2, footprint: "hc49s", notes: [], verification: "parts/X16M/verification.md" })
    expect(json.data.files).toEqual(["parts/X16M/part.yaml", "parts/X16M/X16M.tsx", "parts/X16M/verification.md"])
    expect(json.data.checklist).toContain("- [ ] Pin 2 is XTAL2 (passive)")
    const parts = await (await retryLostConnect(() => fetch(`${server.url}/api/parts`, { headers: { "x-copperflow-token": server.token } }))).json()
    expect(parts.data.library).toEqual([expect.objectContaining({ id: "X16M", verified: false, origin: expect.stringMatching(/^written \d{4}-\d{2}-\d{2}$/) })])
  })

  test("an existing id is refused unless replace; a footprint file writes the placeholder; bad input writes nothing", async () => {
    const server = await open()
    await post(server, CRYSTAL)
    const again = await post(server, CRYSTAL)
    expect(again.status).toBe(400)
    expect(again.json.error).toContain("Part X16M already exists")
    expect((await post(server, { ...CRYSTAL, replace: true })).json.ok).toBe(true)
    const file = await post(server, { ...CRYSTAL, id: "J2", package: { file: "footprint.yaml" } })
    expect(file.json.data.files).toContain("parts/J2/footprint.yaml")
    expect(file.json.data.notes).toEqual([expect.stringContaining("placeholder")])
    const bad = await post(server, { ...CRYSTAL, id: "BAD", package: "soic8" })
    expect(bad.status).toBe(400)
    expect(bad.json.error).toContain('Package "soic8" does not fit the pins')
    expect((await post(server, { ...CRYSTAL, id: "T", pins: [{ number: "1", name: "A", type: "maybe" }] })).status).toBe(400)
    expect((await readdir(join(root, "parts"))).sort()).toEqual(["J2", "X16M"])
  })
})
