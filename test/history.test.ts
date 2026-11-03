import { expect, test } from "vitest"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { historyDir, readEntries, recordEntry } from "../src/core/history.js"

const data = { author: "ai" as const, file: "a.circuit.tsx", summary: "s", before: "a", after: "b" }

test("ids continue after the highest id and sort numerically", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-hist-"))
  await mkdir(historyDir(root), { recursive: true })
  const old = { id: "c9999", time: "t", ...data }
  await writeFile(join(historyDir(root), "c9999.json"), JSON.stringify(old))
  const next = await recordEntry(root, data)
  expect(next.id).toBe("c10000")
  expect((await readEntries(root)).map((e) => e.id)).toEqual(["c9999", "c10000"])
})

test("concurrent writers get consecutive unique ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-hist-"))
  const ids = await Promise.all([1, 2, 3, 4].map(() => recordEntry(root, data).then((e) => e.id)))
  expect([...ids].sort()).toEqual(["c0001", "c0002", "c0003", "c0004"])
})

test("an entry whose id does not match its file name is rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-hist-"))
  await mkdir(historyDir(root), { recursive: true })
  await writeFile(join(historyDir(root), "c0001.json"), JSON.stringify({ id: "c0005", time: "t", ...data }))
  await expect(readEntries(root)).rejects.toThrow(/c0001\.json/)
})
