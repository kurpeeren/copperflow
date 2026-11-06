import { mkdtemp, readdir, readFile, rename } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test, vi } from "vitest"
import { writeFileAtomic, type AtomicWriteOps } from "../src/core/fs-utils.js"

const errno = (code: string) => Object.assign(new Error(`${code}: operation not permitted, rename`), { code })

/** Fails the first `failures` renames with `code`, then renames for real; waits are recorded, not slept. */
function flakyOps(code: string, failures: number) {
  const waits: number[] = []
  const renameSpy = vi.fn(async (from: string, to: string) => {
    if (renameSpy.mock.calls.length <= failures) throw errno(code)
    await rename(from, to)
  })
  const ops: AtomicWriteOps = { rename: renameSpy, wait: async (ms) => void waits.push(ms) }
  return { ops, renameSpy, waits }
}

describe("writeFileAtomic", () => {
  test("writes the file through a rename and leaves no temporary file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-atomic-"))
    await writeFileAtomic(join(dir, "a.txt"), "hello")
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("hello")
    expect(await readdir(dir)).toEqual(["a.txt"])
  })

  test("retries a rename that Windows refuses with EPERM, and succeeds on the third try", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-atomic-"))
    const { ops, renameSpy, waits } = flakyOps("EPERM", 2)
    await writeFileAtomic(join(dir, "a.txt"), "hello", ops)
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("hello")
    expect(renameSpy).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([10, 20])
    expect(await readdir(dir)).toEqual(["a.txt"])
  })

  test("EACCES and EBUSY are retried too", async () => {
    for (const code of ["EACCES", "EBUSY"]) {
      const dir = await mkdtemp(join(tmpdir(), "cf-atomic-"))
      const { ops, renameSpy } = flakyOps(code, 1)
      await writeFileAtomic(join(dir, "a.txt"), "hello", ops)
      expect(renameSpy).toHaveBeenCalledTimes(2)
    }
  })

  test("gives up after ten retries within a second, removes the temporary file and throws the last error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-atomic-"))
    const { ops, renameSpy, waits } = flakyOps("EPERM", Number.POSITIVE_INFINITY)
    await expect(writeFileAtomic(join(dir, "a.txt"), "hello", ops)).rejects.toMatchObject({ code: "EPERM" })
    expect(renameSpy).toHaveBeenCalledTimes(11)
    expect(waits).toEqual([10, 20, 40, 80, 100, 100, 100, 100, 100, 100])
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBeLessThan(1000)
    expect(await readdir(dir)).toEqual([])
  })

  test("other errors fail at once and remove the temporary file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-atomic-"))
    const { ops, renameSpy, waits } = flakyOps("EXDEV", 1)
    await expect(writeFileAtomic(join(dir, "a.txt"), "hello", ops)).rejects.toMatchObject({ code: "EXDEV" })
    expect(renameSpy).toHaveBeenCalledTimes(1)
    expect(waits).toEqual([])
    expect(await readdir(dir)).toEqual([])
  })
})
