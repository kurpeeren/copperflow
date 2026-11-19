// The project folder as the Files tab lists it: folders first, then by name; the skipped folders left out; links listed
// and never entered; the limits on entries and depth.
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, test } from "vitest"
import { isSkippedPath, listProjectFiles, MAX_FILE_DEPTH } from "../src/studio/file-list.js"
import { projectRoot } from "../src/studio/studio-note.js"

let root: string

beforeEach(async () => {
  root = projectRoot(await mkdtemp(join(tmpdir(), "cf-file-list-")))
})

const paths = async (options?: { maxEntries?: number }) => (await listProjectFiles(root, options)).entries.map((entry) => `${entry.kind} ${entry.path}`)

describe("listProjectFiles", () => {
  test("lists folders first, then files, each by name without regard to case, depth first", async () => {
    await mkdir(join(root, "parts", "R1"), { recursive: true })
    await writeFile(join(root, "parts", "R1", "part.yaml"), "title: R\n")
    await mkdir(join(root, "art"))
    await writeFile(join(root, "rules.yaml"), "")
    await writeFile(join(root, "PROJECT.md"), "# P\n")
    await writeFile(join(root, "main.circuit.tsx"), "x")
    expect(await paths()).toEqual(["dir art", "dir parts", "dir parts/R1", "file parts/R1/part.yaml", "file main.circuit.tsx", "file PROJECT.md", "file rules.yaml"])
  })

  test("answers the real root, sizes and modification times, and says it was not cut", async () => {
    await writeFile(join(root, "a.txt"), "12345")
    const listing = await listProjectFiles(root)
    expect(listing.root).toBe(root)
    expect(listing.truncated).toBe(false)
    expect(listing.entries[0]).toMatchObject({ path: "a.txt", kind: "file", size: 5 })
    expect(Number.isNaN(Date.parse(listing.entries[0]!.modified))).toBe(false)
  })

  test("leaves out node_modules, .git and dot-folders, but shows .copperflow and dot-files", async () => {
    for (const folder of ["node_modules/x", ".git/objects", ".vscode", ".copperflow/history"]) await mkdir(join(root, folder), { recursive: true })
    await writeFile(join(root, ".copperflow", "history", "1.json"), "{}")
    await writeFile(join(root, ".gitignore"), "dist\n")
    expect(await paths()).toEqual(["dir .copperflow", "dir .copperflow/history", "file .copperflow/history/1.json", "file .gitignore"])
  })

  test("a link is listed as a link and never entered", async (context) => {
    const outside = projectRoot(await mkdtemp(join(tmpdir(), "cf-file-list-outside-")))
    await writeFile(join(outside, "secret.txt"), "s")
    try {
      // A junction on Windows (no rights needed), a folder link elsewhere.
      await symlink(outside, join(root, "out"), "junction")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return context.skip()
      throw error
    }
    expect(await paths()).toEqual(["link out"])
  })

  test("stops at the entry limit and says it was cut", async () => {
    for (const name of ["a", "b", "c", "d"]) await writeFile(join(root, `${name}.txt`), "")
    const listing = await listProjectFiles(root, { maxEntries: 3 })
    expect(listing.entries.map((entry) => entry.path)).toEqual(["a.txt", "b.txt", "c.txt"])
    expect(listing.truncated).toBe(true)
  })

  test("exactly the entry limit is not a cut", async () => {
    for (const name of ["a", "b"]) await writeFile(join(root, `${name}.txt`), "")
    expect((await listProjectFiles(root, { maxEntries: 2 })).truncated).toBe(false)
  })

  test("does not enter folders deeper than the depth limit, and says so when one holds more", async () => {
    const deep = Array.from({ length: MAX_FILE_DEPTH + 1 }, (_, i) => `d${i}`)
    await mkdir(join(root, ...deep), { recursive: true })
    await writeFile(join(root, ...deep, "end.txt"), "")
    const listing = await listProjectFiles(root)
    expect(listing.entries.map((entry) => entry.path.split("/").length)).toEqual(Array.from({ length: MAX_FILE_DEPTH }, (_, i) => i + 1))
    expect(listing.truncated).toBe(true)
  })

  test("an empty folder at the depth limit is not a cut", async () => {
    await mkdir(join(root, ...Array.from({ length: MAX_FILE_DEPTH }, (_, i) => `d${i}`)), { recursive: true })
    expect((await listProjectFiles(root)).truncated).toBe(false)
  })
})

describe("isSkippedPath", () => {
  test("is true under node_modules, .git and other dot-folders, false under .copperflow and for dot-files", () => {
    expect(isSkippedPath("node_modules/x/index.js")).toBe(true)
    expect(isSkippedPath(".git/HEAD")).toBe(true)
    expect(isSkippedPath(".git")).toBe(true)
    expect(isSkippedPath("parts/.cache/a")).toBe(true)
    expect(isSkippedPath(".copperflow/history/1.json")).toBe(false)
    expect(isSkippedPath(".gitignore")).toBe(false)
    expect(isSkippedPath("parts/R1/part.yaml")).toBe(false)
  })
})
