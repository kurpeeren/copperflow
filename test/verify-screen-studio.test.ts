// The Verify screen's routes: the part with its pads and content hash, ticking verification.md, the refusal of
// Mark verified while items are open, and the part's own datasheet PDF. Paths are compared through the program's own
// real-path function, so a temp folder with a short 8.3 name on Windows reads the same.
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse, stringify } from "yaml"
import { createPart } from "../src/core/library.js"
import type { Studio } from "../src/studio/server.js"
import { projectRoot } from "../src/studio/studio-note.js"
import { BOARD, SHARED } from "./fixtures.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { retryLostConnect, startReachableStudio } from "./helpers/reachable-studio.js"

let root: string
let studio: Studio

const PART = {
  title: "Two-pin crystal",
  footprint: "0402",
  pins: { "1": { name: "A", type: "passive" }, "2": { name: "B", type: "passive" } },
  datasheet: { file: "ds.pdf", title: "Crystal datasheet rev 2" },
  datasheet_pages: "3-4",
}
const PDF = "%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n"

beforeEach(async () => {
  root = projectRoot(await mkdtemp(join(tmpdir(), "cf-verify-screen-")))
  await mkdir(join(root, "static"))
  await writeFile(join(root, "static", "index.html"), "<html></html>")
  await writeFile(join(root, "main.circuit.tsx"), BOARD)
  await writeFile(join(root, "shared.ts"), SHARED)
  await createPart(root, "X1", PART, { now: "t" })
  await writeFile(join(root, "parts", "X1", "ds.pdf"), PDF)
  studio = await startReachableStudio({ root, staticDir: join(root, "static"), builder: inProcessEngine, routeWorker: null })
})

afterEach(async () => {
  await studio.close()
})

async function call(path: string, body?: unknown): Promise<Response> {
  return retryLostConnect(() =>
    fetch(`${studio.url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-copperflow-token": studio.token, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
}

const json = async (path: string, body?: unknown) => {
  const response = await call(path, body)
  return { status: response.status, ...((await response.json()) as { ok: boolean; data?: any; error?: string }) }
}
const checklistPath = () => join(root, "parts", "X1", "verification.md")
const itemsOf = (text: string) => text.split("\n").filter((line) => line.startsWith("- [")).map((line) => line.slice(6))

describe("GET /api/part for the Verify screen", () => {
  test("answers the pads the build uses, the content hash and whether the part is verified", async () => {
    const answer = await json("/api/part?id=X1")
    expect(answer.data.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(answer.data.verified).toBe(false)
    expect(answer.data.footprint.pads.map((pad: { number: string }) => pad.number)).toEqual(["1", "2"])
    expect(answer.data.placeholder).toBeUndefined()
  })

  test("a placeholder footprint.yaml comes with the sentence the server refuses it with", async () => {
    const pads = { placeholder: true, pads: [{ number: "1", shape: "rect", x: -1, y: 0, width: 1, height: 1 }, { number: "2", shape: "rect", x: 1, y: 0, width: 1, height: 1 }] }
    await createPart(root, "J1", { ...PART, datasheet: undefined, footprint: "footprint.yaml" }, { now: "t", footprintFile: pads as never })
    const answer = await json("/api/part?id=J1")
    expect(answer.data.footprint.placeholder).toBe(true)
    expect(answer.data.placeholder).toBe('Part J1 cannot be verified: parts/J1/footprint.yaml is a placeholder; draw its pads from the datasheet\'s land pattern, then delete "placeholder: true"')
  })
})

describe("POST /api/tick", () => {
  test("ticks one item and keeps every other byte; a stale text is refused with the file as it is", async () => {
    const before = await readFile(checklistPath(), "utf8")
    const item = "Pin 1 is A (passive)"
    const ticked = await json("/api/tick", { id: "X1", items: [item], ticked: true, shown: before })
    expect(ticked.ok).toBe(true)
    const after = await readFile(checklistPath(), "utf8")
    expect(after).toBe(before.replace(`- [ ] ${item}`, `- [x] ${item}`))
    expect(ticked.data.checklist).toBe(after)
    const stale = await json("/api/tick", { id: "X1", items: ["Pin 2 is B (passive)"], ticked: true, shown: before })
    expect(stale.status).toBe(409)
    expect(stale.data.checklist).toBe(after)
    expect(await readFile(checklistPath(), "utf8")).toBe(after)
  })

  test("a part changed since the ticks clears them all before the new tick", async () => {
    const all = itemsOf(await readFile(checklistPath(), "utf8"))
    await json("/api/tick", { id: "X1", items: all, ticked: true, shown: await readFile(checklistPath(), "utf8") })
    const yaml = parse(await readFile(join(root, "parts", "X1", "part.yaml"), "utf8"))
    await writeFile(join(root, "parts", "X1", "part.yaml"), stringify({ ...yaml, title: "Two-pin crystal, changed" }))
    const shown = await readFile(checklistPath(), "utf8")
    const answer = await json("/api/tick", { id: "X1", items: ["Pin 2 is B (passive)"], ticked: true, shown })
    const hash = (await json("/api/part?id=X1")).data.hash as string
    expect(answer.data.checklist).toContain(`Content: ${hash.slice(0, 12)}`)
    expect(answer.data.checklist.split("\n").filter((line: string) => line.startsWith("- [x]"))).toEqual(["- [x] Pin 2 is B (passive)"])
  })

  test("an item that is not in the file is refused", async () => {
    const answer = await json("/api/tick", { id: "X1", items: ["Pin 9 is Z (passive)"], ticked: true, shown: await readFile(checklistPath(), "utf8") })
    expect(answer.status).toBe(400)
    expect(answer.error).toContain('verification.md has no item "Pin 9 is Z (passive)"')
  })
})

describe("POST /api/verify needs every item ticked", () => {
  const mark = () => json("/api/verify", { id: "X1", by: "Eren", against: "Crystal datasheet rev 2, page(s) 3-4", confirm: "X1" })

  test("refused with the number of open items, accepted once all are ticked", async () => {
    const text = await readFile(checklistPath(), "utf8")
    const all = itemsOf(text)
    await json("/api/tick", { id: "X1", items: [all[0]], ticked: true, shown: text })
    const refused = await mark()
    expect(refused.status).toBe(400)
    expect(refused.error).toBe(`${all.length - 1} of ${all.length} items of verification.md are not ticked for the part as it is now; tick each one on the Verify screen first`)
    await json("/api/tick", { id: "X1", items: all, ticked: true, shown: await readFile(checklistPath(), "utf8") })
    expect((await mark()).ok).toBe(true)
    expect(parse(await readFile(join(root, "parts", "X1", "part.yaml"), "utf8")).verified).toMatchObject({ by: "Eren", against: "Crystal datasheet rev 2, page(s) 3-4" })
    expect((await json("/api/part?id=X1")).data.verified).toBe(true)
  })
})

describe("GET /api/part-datasheet", () => {
  const sheet = (file: string) => call(`/api/part-datasheet?id=X1&file=${encodeURIComponent(file)}`)

  test("serves the recorded PDF inline, as a PDF, not sniffed", async () => {
    const response = await sheet("ds.pdf")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/pdf")
    expect(response.headers.get("content-disposition")).toBe('inline; filename="ds.pdf"')
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await response.text()).toBe(PDF)
  })

  test("a name not recorded, a path out and a file that is not a PDF are refused", async () => {
    await writeFile(join(root, "parts", "X1", "other.pdf"), PDF)
    expect((await sheet("other.pdf")).status).toBe(404)
    expect((await sheet("../X1/ds.pdf")).status).toBe(404)
    expect((await call("/api/part-datasheet?id=X1")).status).toBe(400)
    await writeFile(join(root, "parts", "X1", "ds.pdf"), "<html>not a pdf</html>")
    const notPdf = await sheet("ds.pdf")
    expect(notPdf.status).toBe(415)
    expect(((await notPdf.json()) as { error: string }).error).toBe("parts/X1/ds.pdf is not a PDF")
  })

  test("a recorded name that is a link out of the part's folder is refused", async (context) => {
    await writeFile(join(root, "outside.pdf"), PDF)
    await mkdir(join(root, "parts", "X1"), { recursive: true })
    const link = join(root, "parts", "X1", "ds.pdf")
    await writeFile(link, "")
    const { rm } = await import("node:fs/promises")
    await rm(link)
    try {
      await symlink(join(root, "outside.pdf"), link, "file")
    } catch (error) {
      // Windows without the right to make links: nothing to test there; CI on Linux makes it.
      if ((error as NodeJS.ErrnoException).code === "EPERM") return context.skip()
      throw error
    }
    const response = await sheet("ds.pdf")
    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: string }).error).toBe("parts/X1/ds.pdf leads out of the part's folder")
  })

  test("a part without a datasheet file says so", async () => {
    await createPart(root, "R9", { ...PART, datasheet: { url: "https://example.com/r.pdf" } }, { now: "t" })
    const response = await call("/api/part-datasheet?id=R9&file=ds.pdf")
    expect(response.status).toBe(404)
    expect(((await response.json()) as { error: string }).error).toBe("Part R9 records no datasheet file")
  })
})

describe("the Studio's page", () => {
  test("may frame only what it made itself (blob:), nothing else is widened", async () => {
    const response = await retryLostConnect(() => fetch(`${studio.url}/`))
    const policy = response.headers.get("content-security-policy") ?? ""
    expect(policy).toContain("frame-src blob:")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain("object-src 'none'")
    expect(response.headers.get("x-frame-options")).toBe("DENY")
  })
})
