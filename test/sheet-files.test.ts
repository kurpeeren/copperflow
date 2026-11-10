import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCircuitFile, listEntries, readEntries, redoChange, undoChange } from "../src/core/index.js"
import { BOARD } from "./fixtures.js"

const CIRCUIT = "a.circuit.tsx"
const SHEET = "Block.sheet.tsx"
const SHEET_TEXT = "export default function Block() {\n  return <sheet></sheet>\n}\n"
const OLD_BOARD = 'export default () => <board width="5mm" height="5mm" />\n'
let root: string

const exists = (file: string) => stat(join(root, file)).then(() => true, () => false)
const read = (file: string) => readFile(join(root, file), "utf8")
const create = (sheets: { file: string; text: string }[], replace = false) =>
  createCircuitFile(root, CIRCUIT, BOARD, { author: "ai", summary: "create", sheets, ...(replace ? { replace } : {}) })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-sheets-"))
})

describe("a circuit written with its sheet files", () => {
  test("is one history entry that names the sheet files; undo removes them all and redo brings them back", async () => {
    await create([{ file: SHEET, text: SHEET_TEXT }])
    expect(await read(SHEET)).toBe(SHEET_TEXT)
    const entries = await readEntries(root)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.also).toEqual([{ file: SHEET, before: "", after: SHEET_TEXT, absent: "before" }])
    await undoChange(root, { author: "ai" })
    expect([await exists(CIRCUIT), await exists(SHEET)]).toEqual([false, false])
    await redoChange(root, { author: "ai" })
    expect([await read(CIRCUIT), await read(SHEET)]).toEqual([BOARD, SHEET_TEXT])
    expect(await listEntries(root, 10)).toHaveLength(3)
  })

  test("an existing sheet file is refused without replace, and nothing is written", async () => {
    await writeFile(join(root, SHEET), "old")
    await expect(create([{ file: SHEET, text: SHEET_TEXT }])).rejects.toThrow(/Block\.sheet\.tsx already exists; pass replace: true/)
    expect(await exists(CIRCUIT)).toBe(false)
    expect(await read(SHEET)).toBe("old")
    expect(await listEntries(root, 10)).toHaveLength(0)
  })

  test("replace overwrites an existing sheet file, and undo restores it", async () => {
    await writeFile(join(root, CIRCUIT), OLD_BOARD)
    await writeFile(join(root, SHEET), "old")
    await create([{ file: SHEET, text: SHEET_TEXT }], true)
    expect(await read(SHEET)).toBe(SHEET_TEXT)
    await undoChange(root, { author: "ai" })
    expect([await read(CIRCUIT), await read(SHEET)]).toEqual([OLD_BOARD, "old"])
  })

  test("a sheet file must end in .sheet.tsx and stay inside the project", async () => {
    await expect(create([{ file: "Block.tsx", text: SHEET_TEXT }])).rejects.toThrow(/must end in \.sheet\.tsx/)
    await expect(create([{ file: "../Block.sheet.tsx", text: SHEET_TEXT }])).rejects.toThrow(/outside the project root/)
    expect(await exists(CIRCUIT)).toBe(false)
  })

  test("a sheet file in a new folder is created", async () => {
    await create([{ file: "blocks/Block.sheet.tsx", text: SHEET_TEXT }])
    expect(await read("blocks/Block.sheet.tsx")).toBe(SHEET_TEXT)
  })

  test("undo is refused once a sheet file changed, and nothing is undone", async () => {
    await create([{ file: SHEET, text: SHEET_TEXT }])
    await writeFile(join(root, SHEET), "edited by hand")
    await expect(undoChange(root, { author: "ai" })).rejects.toThrow(/Block\.sheet\.tsx has changed since c0001/)
    expect(await read(CIRCUIT)).toBe(BOARD)
  })

  test("a later change to a sheet file stops the redo of the undo", async () => {
    await create([{ file: SHEET, text: SHEET_TEXT }])
    await undoChange(root, { author: "ai" })
    await writeFile(join(root, SHEET), "made again by hand")
    await expect(redoChange(root, { author: "ai" })).rejects.toThrow(/Block\.sheet\.tsx exists again/)
    expect(await exists(CIRCUIT)).toBe(false)
  })
})
