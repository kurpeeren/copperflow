import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createProject } from "../../src/desktop/index.js"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cf-create-"))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe("createProject", () => {
  it("makes the folder with an empty starter circuit", async () => {
    const result = await createProject(dir, "Power Board")
    expect(result.root).toBe(join(dir, "Power Board"))
    expect(result.circuit).toBe("power-board.circuit.tsx")
    const text = await readFile(join(result.root, result.circuit), "utf8")
    expect(text).toContain("<board")
    expect(text).toContain("30")
  })

  it("accepts a folder that exists but is empty", async () => {
    await mkdir(join(dir, "empty"))
    expect((await createProject(dir, "empty")).circuit).toBe("empty.circuit.tsx")
  })

  it("refuses a folder that has files", async () => {
    await mkdir(join(dir, "used"))
    await writeFile(join(dir, "used", "a.txt"), "x")
    await expect(createProject(dir, "used")).rejects.toThrow(/not empty/)
    expect(await readdir(join(dir, "used"))).toEqual(["a.txt"])
  })

  it.each(["", "  ", "a/b", "a\\b", "a:b", "what?", "a*", 'q"', "<x>", "pipe|", "dots..", "trail.", " lead", "trail ", "CON", "nul.txt"])(
    "refuses the name %j",
    async (name) => {
      await expect(createProject(dir, name)).rejects.toThrow()
      expect(await readdir(dir)).toEqual([])
    },
  )

  it("names the circuit main when the name has no letters or digits", async () => {
    expect((await createProject(dir, "ÄÖ")).circuit).toBe("main.circuit.tsx")
  })

  it("refuses a parent folder that is not a full path", async () => {
    await expect(createProject("projects", "a")).rejects.toThrow(/full path/)
  })

  it("refuses a parent folder that does not exist, and makes nothing", async () => {
    const mistyped = join(dir, "no", "such")
    await expect(createProject(mistyped, "a")).rejects.toThrow(/does not exist/)
    expect(await readdir(dir)).toEqual([])
  })

  it("refuses a parent that is a file", async () => {
    await writeFile(join(dir, "file.txt"), "x")
    await expect(createProject(join(dir, "file.txt"), "a")).rejects.toThrow(/not a folder/)
  })

  it("refuses a circuit file path longer than 250 characters", async () => {
    const parent = join(dir, "p".repeat(Math.max(1, 200 - dir.length)))
    await mkdir(parent)
    const name = "n".repeat(60)
    await expect(createProject(parent, name)).rejects.toThrow(/too long/)
    expect(await readdir(parent)).toEqual([])
  })

  it("removes the folder it made when the starter circuit cannot be written, so the same name works again", async () => {
    const failing = async () => {
      throw new Error("disk full")
    }
    await expect(createProject(dir, "Board", failing)).rejects.toThrow("disk full")
    expect(await readdir(dir)).toEqual([])
    expect((await createProject(dir, "Board")).circuit).toBe("board.circuit.tsx")
  })

  it("keeps an empty folder the person had made when the starter circuit fails", async () => {
    await mkdir(join(dir, "mine"))
    await expect(createProject(dir, "mine", async () => Promise.reject(new Error("disk full")))).rejects.toThrow("disk full")
    expect(await readdir(dir)).toEqual(["mine"])
  })
})
