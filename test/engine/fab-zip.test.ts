import { deflateRawSync } from "node:zlib"
import { describe, expect, test } from "vitest"
import { DEFLATE_LEVEL, zipFiles } from "../../src/engine/fab/zip.js"
import { readZip } from "../helpers/zip-read.js"

const CREATED = new Date(Date.UTC(2026, 10, 10, 9, 5, 7))

describe("the zip writer", () => {
  test("keeps the entries in the order given, with their bytes, a checked CRC-32 and the creation date as their time", () => {
    const long = "G01*\nX1000000Y2000000D01*\n".repeat(200)
    const entries = readZip(zipFiles([{ name: "b-F_Cu.gtl", text: long }, { name: "b-bom.csv", text: "a" }, { name: "empty.txt", text: "" }], CREATED))
    expect(entries.map((e) => e.name)).toEqual(["b-F_Cu.gtl", "b-bom.csv", "empty.txt"])
    expect(entries.map((e) => e.data.toString("utf8"))).toEqual([long, "a", ""])
    // Deflated when that is smaller, else stored.
    expect(entries.map((e) => e.method)).toEqual([8, 0, 0])
    // The time is UTC in two-second steps: 09:05:07 is written as 09:05:06.
    expect(entries[0]?.modified).toEqual({ year: 2026, month: 11, day: 10, hours: 9, minutes: 5, seconds: 6 })
    expect(entries.every((e) => e.flags === 0x0800)).toBe(true)
  })

  test("the same files and date give the same bytes; another date changes them", () => {
    const files = [{ name: "a.txt", text: "x".repeat(500) }]
    expect(Buffer.from(zipFiles(files, CREATED)).equals(Buffer.from(zipFiles(files, CREATED)))).toBe(true)
    expect(Buffer.from(zipFiles(files, CREATED)).equals(Buffer.from(zipFiles(files, new Date(Date.UTC(2027, 0, 1)))))).toBe(false)
  })

  test("deflates at a level it names, zlib's normal level 6, not whatever zlib's default is", () => {
    const text = "X1000000Y2000000D01*\n".repeat(300)
    expect(DEFLATE_LEVEL).toBe(6)
    const zip = Buffer.from(zipFiles([{ name: "a.gtl", text }], CREATED))
    const body = deflateRawSync(Buffer.from(text, "utf8"), { level: DEFLATE_LEVEL })
    expect(zip.subarray(30 + "a.gtl".length, 30 + "a.gtl".length + body.length).equals(body)).toBe(true)
  })

  test("an empty archive is just the end record", () => {
    expect(zipFiles([], CREATED)).toHaveLength(22)
    expect(readZip(zipFiles([], CREATED))).toEqual([])
  })
})
