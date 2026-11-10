import { EditError } from "../src/core/edit-error.js"
import { expect, test } from "vitest"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { historyDir, listHistory, readEntries, recordEntry } from "../src/core/history.js"

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

test("recording an entry with an author the history cannot read back is refused, and nothing is written", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-hist-"))
  const bad = recordEntry(root, { ...data, author: "agent" as never })
  await expect(bad).rejects.toBeInstanceOf(EditError)
  await expect(bad).rejects.toThrow(/author.*"ai"\|"human"/)
  expect(await readEntries(root)).toEqual([])
})

test("a listing with one corrupt entry beside good ones returns the good ones and names the problem", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-hist-"))
  await recordEntry(root, data)
  await writeFile(join(historyDir(root), "c0002.json"), JSON.stringify({ id: "c0002", time: "t", ...data, author: "agent" }))
  await recordEntry(root, data)
  const { entries, problems } = await listHistory(root, 10)
  expect(entries.map((e) => e.id)).toEqual(["c0003", "c0001"])
  expect(problems).toHaveLength(1)
  expect(problems[0]).toMatchObject({ file: "c0002.json", reason: expect.stringMatching(/c0002\.json.*not a valid history entry/) })
})
