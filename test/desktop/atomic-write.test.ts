import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { writeFileAtomic } from "../../src/desktop/atomic-write.js"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cf-atomic-"))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const busy = (code: string) => Object.assign(new Error(`${code}: resource busy`), { code })
const noWait = async () => undefined

describe("writeFileAtomic", () => {
  it("writes the file and its folder, and leaves no temporary file", async () => {
    const file = join(dir, "deep", "a.json")
    await writeFileAtomic(file, "one")
    expect(await readFile(file, "utf8")).toBe("one")
    expect(await readdir(join(dir, "deep"))).toEqual(["a.json"])
  })

  it("gives each call its own temporary file", async () => {
    const temps: string[] = []
    const rename = async (from: string) => {
      temps.push(from)
      await rm(from)
    }
    await writeFileAtomic(join(dir, "a.json"), "one", { rename })
    await writeFileAtomic(join(dir, "a.json"), "two", { rename })
    expect(new Set(temps).size).toBe(2)
    expect(temps.every((temp) => temp.includes(`.${process.pid}.`))).toBe(true)
  })

  it.runIf(process.platform !== "win32")("keeps the mode of the file it replaces", async () => {
    const file = join(dir, "a.json")
    await writeFile(file, "old")
    await chmod(file, 0o600)
    await writeFileAtomic(file, "new")
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it("writes through a symbolic link to its target, and the link stays a link", async (context) => {
    const real = join(dir, "real.json")
    const link = join(dir, "link.json")
    await writeFile(real, "old")
    try {
      await symlink(real, link, "file")
    } catch (error) {
      // Windows makes symbolic links only with developer mode or as an administrator.
      if ((error as NodeJS.ErrnoException).code === "EPERM") return context.skip()
      throw error
    }
    await writeFileAtomic(link, "new")
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    expect(await readFile(real, "utf8")).toBe("new")
  })

  it("removes the temporary file when the rename fails", async () => {
    const file = join(dir, "a.json")
    const failing = async () => {
      throw busy("EXDEV")
    }
    await expect(writeFileAtomic(file, "x", { rename: failing })).rejects.toMatchObject({ code: "EXDEV" })
    expect(await readdir(dir)).toEqual([])
  })

  it("on Windows retries a rename refused while another program holds the file", async () => {
    const file = join(dir, "a.json")
    let tries = 0
    const held = async (from: string, to: string) => {
      tries++
      if (tries < 3) throw busy("EBUSY")
      await writeFile(to, await readFile(from))
      await rm(from)
    }
    await writeFileAtomic(file, "done", { rename: held, platform: "win32", wait: noWait })
    expect(tries).toBe(3)
    expect(await readFile(file, "utf8")).toBe("done")
  })

  it("on Windows gives up after a few tries with a plain message and no temporary file", async () => {
    const file = join(dir, "a.json")
    let tries = 0
    const held = async () => {
      tries++
      throw busy("EPERM")
    }
    await expect(writeFileAtomic(file, "x", { rename: held, platform: "win32", wait: noWait })).rejects.toThrow(/could not be replaced.*another program/)
    expect(tries).toBeGreaterThan(1)
    expect(await readdir(dir)).toEqual([])
  })

  it("does not retry on other systems", async () => {
    let tries = 0
    const held = async () => {
      tries++
      throw busy("EACCES")
    }
    await expect(writeFileAtomic(join(dir, "a.json"), "x", { rename: held, platform: "linux", wait: noWait })).rejects.toMatchObject({ code: "EACCES" })
    expect(tries).toBe(1)
  })

  it("leaves a folder in the way alone", async () => {
    const file = join(dir, "a.json")
    await mkdir(file)
    await expect(writeFileAtomic(file, "x")).rejects.toThrow()
    expect(await readdir(dir)).toEqual(["a.json"])
  })
})
