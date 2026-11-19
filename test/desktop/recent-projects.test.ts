import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MAX_RECENT_PROJECTS } from "../../src/desktop/recent-projects.js"
import { recentProjects } from "../../src/desktop/index.js"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cf-recent-"))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

async function folder(name: string, files: string[] = []): Promise<string> {
  const root = join(dir, name)
  await mkdir(root, { recursive: true })
  for (const file of files) await writeFile(join(root, file), "")
  return root
}

describe("recentProjects", () => {
  it("is empty when the store file does not exist", async () => {
    expect(await recentProjects(join(dir, "store.json")).list()).toEqual([])
  })

  it("lists the newest first with name and circuit files", async () => {
    const store = recentProjects(join(dir, "store.json"))
    await store.add(await folder("a", ["x.circuit.tsx", "notes.txt"]))
    const list = await store.add(await folder("b"))
    expect(list.map((p) => p.name)).toEqual(["b", "a"])
    expect(list[1]).toMatchObject({ circuits: ["x.circuit.tsx"], missing: false })
    expect(new Date(list[0]!.opened).toISOString()).toBe(list[0]!.opened)
  })

  it("lists a folder once and moves it to the front", async () => {
    const store = recentProjects(join(dir, "store.json"))
    const a = await folder("a")
    await store.add(a)
    await store.add(await folder("b"))
    const list = await store.add(a)
    expect(list.map((p) => p.name)).toEqual(["a", "b"])
  })

  it.runIf(process.platform === "win32")("treats paths that differ in case as one folder on Windows", async () => {
    const store = recentProjects(join(dir, "store.json"))
    const a = await folder("Alpha")
    await store.add(a)
    expect(await store.add(a.toUpperCase())).toHaveLength(1)
  })

  it("keeps at most the limit", async () => {
    const store = recentProjects(join(dir, "store.json"))
    for (let i = 0; i < MAX_RECENT_PROJECTS + 3; i++) await store.add(await folder(`p${i}`))
    const list = await store.list()
    expect(list).toHaveLength(MAX_RECENT_PROJECTS)
    expect(list[0]!.name).toBe(`p${MAX_RECENT_PROJECTS + 2}`)
  })

  it("lists a missing folder as missing and remove drops it", async () => {
    const store = recentProjects(join(dir, "store.json"))
    const gone = await folder("gone")
    await store.add(gone)
    await rm(gone, { recursive: true })
    expect((await store.list())[0]).toMatchObject({ name: "gone", missing: true, circuits: [] })
    expect(await store.remove(gone)).toEqual([])
    expect(await store.list()).toEqual([])
  })

  it("keeps a broken store aside under a dated name and starts empty", async () => {
    const file = join(dir, "store.json")
    await writeFile(file, "{ not json")
    expect(await recentProjects(file).list()).toEqual([])
    const kept = (await readdir(dir)).filter((name) => name.startsWith("store.json.broken-"))
    expect(kept).toHaveLength(1)
    expect(await readFile(join(dir, kept[0]!), "utf8")).toBe("{ not json")
  })

  it("never overwrites a broken store kept earlier", async () => {
    const file = join(dir, "store.json")
    const store = recentProjects(file)
    await writeFile(file, "first")
    await store.list()
    await writeFile(file, "second")
    await store.list()
    const kept = (await readdir(dir)).filter((name) => name.startsWith("store.json.broken-"))
    expect(kept).toHaveLength(2)
    expect((await Promise.all(kept.map((name) => readFile(join(dir, name), "utf8")))).sort()).toEqual(["first", "second"])
  })

  it("leaves a store from a newer version alone and reads it as empty", async () => {
    const file = join(dir, "store.json")
    const newer = JSON.stringify({ version: 99, projects: [{ root: dir, opened: "2026-01-01T00:00:00.000Z" }], more: true })
    await writeFile(file, newer)
    const store = recentProjects(file)
    expect(await store.list()).toEqual([])
    await store.add(await folder("a"))
    await store.remove(dir)
    expect(await readFile(file, "utf8")).toBe(newer)
    expect(await readdir(dir)).toEqual(["a", "store.json"])
  })

  it("survives quick concurrent adds and leaves no temporary file", async () => {
    const file = join(dir, "store.json")
    const store = recentProjects(file)
    const roots = await Promise.all([folder("a"), folder("b"), folder("c")])
    await Promise.all(roots.map((root) => store.add(root)))
    expect(await store.list()).toHaveLength(3)
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([])
  })

  it("creates the folder of the store file", async () => {
    const file = join(dir, "deep", "er", "store.json")
    await recentProjects(file).add(await folder("a"))
    expect(await recentProjects(file).list()).toHaveLength(1)
  })
})
