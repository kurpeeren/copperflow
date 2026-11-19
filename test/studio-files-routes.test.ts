// The Files tab's two routes: GET /api/files (the folder as a flat list) and GET /api/file (one file for the preview),
// behind the same key as every other route; paths that lead out of the project are refused, SVG cannot run script.
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { MAX_IMAGE_BYTES, MAX_TEXT_BYTES } from "../src/studio/file-routes.js"
import type { Studio } from "../src/studio/server.js"
import { projectRoot } from "../src/studio/studio-note.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { retryLostConnect, startReachableStudio } from "./helpers/reachable-studio.js"

let root: string
let studio: Studio

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'

beforeEach(async () => {
  root = projectRoot(await mkdtemp(join(tmpdir(), "cf-files-routes-")))
  await mkdir(join(root, "static"))
  await writeFile(join(root, "static", "index.html"), "<html></html>")
  await mkdir(join(root, "pics"))
  await writeFile(join(root, "pics", "board.png"), PNG)
  await writeFile(join(root, "pics", "logo.svg"), SVG)
  await writeFile(join(root, "PROJECT.md"), "# Project\n")
  await writeFile(join(root, "board-fab.zip"), "PK")
  studio = await startReachableStudio({ root, staticDir: join(root, "static"), builder: inProcessEngine, routeWorker: null, placeWorker: null })
})

afterEach(async () => {
  await studio.close()
})

const call = (path: string, token = studio.token) => retryLostConnect(() => fetch(`${studio.url}${path}`, { headers: { "x-copperflow-token": token } }))
const json = async (path: string) => {
  const response = await call(path)
  return { status: response.status, ...((await response.json()) as { ok: boolean; data?: any; error?: string }) }
}
const file = (path: string) => `/api/file?path=${encodeURIComponent(path)}`

describe("GET /api/files", () => {
  test("answers the root and the folder in tree order", async () => {
    const answer = await json("/api/files")
    expect(answer.status).toBe(200)
    expect(answer.data.root).toBe(root)
    expect(answer.data.truncated).toBe(false)
    expect(answer.data.entries.map((entry: { path: string }) => entry.path)).toEqual(["pics", "pics/board.png", "pics/logo.svg", "static", "static/index.html", "board-fab.zip", "PROJECT.md"])
  })

  test("needs the session key", async () => {
    expect((await call("/api/files", "x".repeat(48))).status).toBe(403)
    expect((await call(file("PROJECT.md"), "x".repeat(48))).status).toBe(403)
  })
})

describe("GET /api/file", () => {
  test("a text kind comes as UTF-8 text", async () => {
    const answer = await json(file("PROJECT.md"))
    expect(answer.data).toEqual({ kind: "text", text: "# Project\n", truncated: false, size: 10 })
  })

  test("a text file over the limit comes cut at a character boundary, and says so", async () => {
    // Three-byte characters: the limit falls inside one, which must not be cut in half.
    const text = "€".repeat(Math.ceil(MAX_TEXT_BYTES / 3) + 10)
    await writeFile(join(root, "big.txt"), text)
    const answer = await json(file("big.txt"))
    expect(answer.data.truncated).toBe(true)
    expect(Buffer.byteLength(answer.data.text)).toBeLessThanOrEqual(MAX_TEXT_BYTES)
    expect(answer.data.text).toBe("€".repeat(Math.floor(MAX_TEXT_BYTES / 3)))
  })

  test("Gerber, drill and KiCad files are text kinds", async () => {
    for (const name of ["top.gtl", "board.drl", "board.gm1", "a.kicad_pcb", "b.kicad_sch"]) {
      await writeFile(join(root, name), "G04*")
      expect([name, (await json(file(name))).data.kind]).toEqual([name, "text"])
    }
  })

  test("an image comes as its bytes with its type", async () => {
    const response = await call(file("pics/board.png"))
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/png")
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG)
  })

  test("an SVG is served so that it cannot run script", async () => {
    const response = await call(file("pics/logo.svg"))
    expect(response.headers.get("content-type")).toBe("image/svg+xml")
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await response.text()).toBe(SVG)
  })

  test("an image over the limit is refused", async () => {
    await writeFile(join(root, "huge.png"), Buffer.alloc(MAX_IMAGE_BYTES + 1))
    expect((await call(file("huge.png"))).status).toBe(413)
  })

  test("any other kind is 415", async () => {
    const answer = await json(file("board-fab.zip"))
    expect(answer.status).toBe(415)
  })

  test("paths that leave the project, absolute paths and missing files are refused", async () => {
    expect((await json(file("../outside.md"))).status).toBe(400)
    expect((await json(file("pics/../../outside.md"))).status).toBe(400)
    expect((await json(file(join(root, "PROJECT.md")))).status).toBe(400)
    expect((await json(file("/etc/hosts.txt"))).status).toBe(400)
    expect((await json(file("missing.md"))).status).toBe(404)
    expect((await json(file("pics"))).status).toBe(404)
    expect((await json("/api/file")).status).toBe(400)
  })

  test("a file in a folder the list leaves out is not served", async () => {
    await mkdir(join(root, ".git"))
    await writeFile(join(root, ".git", "config.txt"), "secret")
    expect((await json(file(".git/config.txt"))).status).toBe(404)
  })

  test("a link that leads out of the project is refused", async () => {
    const outside = projectRoot(await mkdtemp(join(tmpdir(), "cf-files-outside-")))
    await writeFile(join(outside, "secret.md"), "secret")
    // A junction on Windows (no rights needed), a folder link elsewhere.
    await symlink(outside, join(root, "out"), "junction")
    const answer = await json(file("out/secret.md"))
    expect(answer.status).toBe(400)
    expect(answer.error).toBe("out/secret.md leads out of the project")
  })
})
