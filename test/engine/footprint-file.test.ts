import { describe, expect, test } from "vitest"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { stringify } from "yaml"
import { FootprintFileSchema, footprintFromFile, pinErrors } from "../../src/engine/footprints/file.js"
import { generateFootprint } from "../../src/engine/footprints/index.js"
import type { Footprint } from "../../src/engine/footprints/types.js"
import { contentHash, createPart, generateComponent, isVerified, listParts, readPart, verifyPart } from "../../src/core/library.js"
import { LDO, USBX, USBX_FOOTPRINT } from "../fixtures.js"

const NOW = "2026-11-05T10:00:00.000Z"
const PATH = "parts/USBX/footprint.yaml"
const text = (file: unknown) => stringify(file)

function made(source: string): Footprint {
  const result = footprintFromFile(PATH, source)
  if ("error" in result) throw new Error(result.error)
  return result
}

describe("footprintFromFile", () => {
  test("turns a round drill into a square size and fills in defaults", () => {
    const fp = made(text({ pads: [{ number: "1", shape: "circle", x: 0, y: 0, width: 1.2, height: 1.2, layers: "through", drill: 0.6 }] }))
    expect(fp.pads[0]).toMatchObject({ number: "1", rotation: 0, layers: "through", drill: { width: 0.6, height: 0.6 } })
  })

  test("pads default to the top layer", () => {
    expect(made(text(USBX_FOOTPRINT)).pads[0]?.layers).toBe("top")
  })

  test("the default courtyard is the pad bounds plus 0.25 mm and the origin names the file", () => {
    const fp = made(text(USBX_FOOTPRINT))
    const xs = fp.courtyard.map((p) => p.x)
    const ys = fp.courtyard.map((p) => p.y)
    expect(Math.min(...xs)).toBeCloseTo(-4.5 - 0.25)
    expect(Math.max(...xs)).toBeCloseTo(4.5 + 0.25)
    expect(Math.min(...ys)).toBeCloseTo(-2 - 0.25)
    expect(Math.max(...ys)).toBeCloseTo(1.6 + 0.25)
    expect(fp.origin).toContain(PATH)
  })

  test("an explicit courtyard, silkscreen and body are used as given", () => {
    const fp = made(
      text({ ...USBX_FOOTPRINT, courtyard: [[-5, -3], [5, -3], [5, 3], [-5, 3]], silkscreen: [[[0, 0], [1, 1]]], body: [[-4, -2], [4, -2], [4, 2], [-4, 2]] }),
    )
    expect(fp.courtyard).toEqual([{ x: -5, y: -3 }, { x: 5, y: -3 }, { x: 5, y: 3 }, { x: -5, y: 3 }])
    expect(fp.silkscreen).toEqual([[{ x: 0, y: 0 }, { x: 1, y: 1 }]])
    expect(fp.fabrication).toHaveLength(1)
  })

  test("a pad number written as a YAML number is read as text", () => {
    expect(made("pads:\n  - { number: 1, shape: rect, x: 0, y: 0, width: 1, height: 1 }\n").pads[0]?.number).toBe("1")
  })

  test("a through pad without a drill is refused", () => {
    const result = footprintFromFile(PATH, text({ pads: [{ number: "1", shape: "circle", x: 0, y: 0, width: 1, height: 1, layers: "through" }] }))
    expect(result).toMatchObject({ error: expect.stringMatching(/pad 1.*drill/) })
  })

  test("a top pad with a drill is refused", () => {
    const result = footprintFromFile(PATH, text({ pads: [{ number: "2", shape: "rect", x: 0, y: 0, width: 1, height: 1, drill: 0.4 }] }))
    expect(result).toMatchObject({ error: expect.stringMatching(/pad 2.*drill/) })
  })

  test("bad YAML, unknown keys and empty pad lists are errors that name the file", () => {
    const bad = [
      "pads: [",
      text({ pads: [] }),
      text({ pads: USBX_FOOTPRINT.pads, extra: 1 }),
      text({ pads: [{ number: "1", shape: "rect", x: "a", y: 0, width: 1, height: 1 }] }),
    ]
    for (const source of bad) expect(footprintFromFile(PATH, source)).toMatchObject({ error: expect.stringContaining(PATH) })
  })

  test("the schema is exported for the MCP tool", () => {
    expect(FootprintFileSchema.safeParse(USBX_FOOTPRINT).success).toBe(true)
  })
})

describe("pin numbers", () => {
  test("a pad numbered 9 on a 5-pin part is an error naming pad 9", () => {
    const file = { pads: [...USBX_FOOTPRINT.pads, { number: "9", shape: "rect" as const, x: 0, y: 3, width: 1, height: 1 }] }
    expect(pinErrors(file, USBX)).toEqual([expect.stringMatching(/pad 9.*not a pin/)])
  })

  test("every pin except no_connect needs a pad", () => {
    const file = { pads: USBX_FOOTPRINT.pads.filter((pad) => pad.number !== "3") }
    expect(pinErrors(file, USBX)).toEqual([expect.stringMatching(/pin 3 \(DP\).*no pad/)])
    const noConnect = { ...USBX, pins: { ...USBX.pins, "3": { name: "NC", type: "no_connect" as const } } }
    expect(pinErrors(file, noConnect)).toEqual([])
  })

  test("several pads may share a number", () => {
    expect(pinErrors(USBX_FOOTPRINT, USBX)).toEqual([])
  })
})

describe("generateFootprint with a file path", () => {
  const read = (source: string) => (path: string) => (path === PATH ? source : undefined)

  test("reads the file through readFile", () => {
    const result = generateFootprint(PATH, read(text(USBX_FOOTPRINT)))
    expect("error" in result).toBe(false)
    expect((result as Footprint).pads).toHaveLength(6)
  })

  test("editing the file text changes the result", () => {
    const before = generateFootprint(PATH, read(text(USBX_FOOTPRINT))) as Footprint
    const moved = { pads: USBX_FOOTPRINT.pads.map((pad, i) => (i === 0 ? { ...pad, x: -2 } : pad)) }
    const after = generateFootprint(PATH, read(text(moved))) as Footprint
    expect(before.pads[0]?.x).toBe(-1.5)
    expect(after.pads[0]?.x).toBe(-2)
  })

  test("refuses paths outside parts/<id>/footprint.yaml", () => {
    const anything = () => text(USBX_FOOTPRINT)
    const paths = ["parts/../secret/footprint.yaml", "parts/../footprint.yaml", "../parts/A/footprint.yaml", "parts/A/other.yaml", "/etc/passwd", "parts/A/b/footprint.yaml"]
    for (const path of paths) expect(generateFootprint(path, anything)).toMatchObject({ error: expect.any(String) })
  })

  test("a path without a way to read files is an error, and a missing file too", () => {
    expect(generateFootprint(PATH)).toMatchObject({ error: expect.any(String) })
    expect(generateFootprint(PATH, () => undefined)).toMatchObject({ error: expect.stringContaining(PATH) })
  })
})

describe("library parts with a footprint file", () => {
  async function project() {
    const root = await mkdtemp(join(tmpdir(), "cf-fpf-"))
    await createPart(root, "USBX", USBX, { footprintFile: USBX_FOOTPRINT, now: NOW })
    return root
  }

  test("createPart writes footprint.yaml, lists it among the files and adds the checklist line", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-fpf-"))
    const result = await createPart(root, "USBX", USBX, { footprintFile: USBX_FOOTPRINT, now: NOW })
    expect(result.files).toContain(PATH)
    expect(await readFile(join(root, PATH), "utf8")).toContain('number: "5"')
    expect(await readFile(join(root, "parts", "USBX", "verification.md"), "utf8")).toContain(
      "- [ ] Every pad in footprint.yaml matches the recommended land pattern (position, size, drill)",
    )
  })

  test("a part that names footprint.yaml needs the file, and a file needs that name", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-fpf-"))
    await expect(createPart(root, "USBX", USBX, { now: NOW })).rejects.toThrow(/footprint\.yaml/)
    await expect(createPart(root, "USBX", { ...USBX, footprint: "sot23_5" }, { footprintFile: USBX_FOOTPRINT, now: NOW })).rejects.toThrow(/footprint\.yaml/)
  })

  test("pad errors are refused by createPart, naming the pad, and nothing is written", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-fpf-"))
    const bad = { pads: [...USBX_FOOTPRINT.pads, { number: "9", shape: "rect" as const, x: 0, y: 3, width: 1, height: 1 }] }
    await expect(createPart(root, "USBX", USBX, { footprintFile: bad, now: NOW })).rejects.toThrow(/pad 9/)
    expect(await listParts(root)).toEqual([])
  })

  test("pad errors in a hand-edited file surface through readPart and listParts", async () => {
    const root = await project()
    const path = join(root, PATH)
    await writeFile(path, (await readFile(path, "utf8")).replace('number: "4"', 'number: "9"'))
    await expect(readPart(root, "USBX")).rejects.toThrow(/pad 9/)
    expect((await listParts(root))[0]?.error).toMatch(/pad 9/)
  })

  test("a verified part with a footprint file turns unverified when one pad moves", async () => {
    const root = await project()
    await verifyPart(root, "USBX", { by: "Eren", against: "USB-C datasheet p. 9" }, NOW)
    expect((await listParts(root))[0]?.verified).toBe(true)
    const path = join(root, PATH)
    await writeFile(path, (await readFile(path, "utf8")).replace("x: -1.5", "x: -1.4"))
    expect((await listParts(root))[0]?.verified).toBe(false)
  })

  test("a verified part with a footprint file cannot be replaced", async () => {
    const root = await project()
    await verifyPart(root, "USBX", { by: "Eren", against: "USB-C datasheet p. 9" }, NOW)
    await expect(createPart(root, "USBX", USBX, { replace: true, footprintFile: USBX_FOOTPRINT, now: NOW })).rejects.toThrow(/verified/)
  })

  test("LF and CRLF copies of one footprint file hash the same, and so does one with a byte order mark", () => {
    const lf = text(USBX_FOOTPRINT)
    expect(contentHash(USBX, lf.replace(/\n/g, "\r\n"))).toBe(contentHash(USBX, lf))
    expect(contentHash(USBX, `﻿${lf}`)).toBe(contentHash(USBX, lf))
    expect(contentHash(USBX, lf.replace("x: -1.5", "x: -1.4"))).not.toBe(contentHash(USBX, lf))
  })

  test("a verified part stays verified after its footprint file is rewritten with CRLF line endings", async () => {
    const root = await project()
    await verifyPart(root, "USBX", { by: "Eren", against: "USB-C datasheet p. 9" }, NOW)
    const path = join(root, PATH)
    await writeFile(path, (await readFile(path, "utf8")).replace(/\n/g, "\r\n"))
    expect((await listParts(root))[0]?.verified).toBe(true)
  })

  test("isVerified takes the footprint text into account", () => {
    const hashed = { ...USBX, verified: { by: "E", against: "d", date: NOW, hash: contentHash(USBX, "pads: a") } }
    expect(isVerified(hashed, "pads: a")).toBe(true)
    expect(isVerified(hashed, "pads: b")).toBe(false)
    expect(isVerified(hashed)).toBe(false)
  })

  test("the generated component points at the footprint file", () => {
    expect(generateComponent("USBX", USBX)).toContain('footprint={"parts/USBX/footprint.yaml"}')
  })
})

describe("parts without a footprint file keep their verification", () => {
  test("the content hash of the LDO fixture is the one computed before footprint files existed", () => {
    const before = "9e13580062af3d07f01f77aef89e1bc1a552468a3a68165f9b54c05b046df487"
    expect(contentHash(LDO)).toBe(before)
    expect(isVerified({ ...LDO, verified: { by: "E", against: "d", date: NOW, hash: before } })).toBe(true)
  })
})
