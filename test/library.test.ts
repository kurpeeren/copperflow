import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseSource } from "../src/core/analyze.js"
import {
  componentName,
  createPart,
  generateComponent,
  listParts,
  readPart,
  rebuildComponents,
  verifyPart,
} from "../src/core/library.js"
import { LDO } from "./fixtures.js"

const NOW = "2026-11-03T10:00:00.000Z"
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-lib-"))
})

describe("names", () => {
  test("component names are identifiers made from the part id", () => {
    expect(componentName("AP2112K-3.3")).toBe("AP2112K_3_3")
  })

  test("ids that could leave the parts folder are rejected", async () => {
    for (const id of ["../evil", "a/b", "1abc", "..", "a..b"]) {
      await expect(createPart(root, id, LDO, { now: NOW })).rejects.toThrow(/part id/)
    }
  })
})

describe("creating parts", () => {
  test("writes part.yaml, the generated component and a verification checklist", async () => {
    const result = await createPart(root, "AP2112K-3.3", LDO, { now: NOW })
    expect(result.files).toEqual([
      "parts/AP2112K-3.3/part.yaml",
      "parts/AP2112K-3.3/AP2112K_3_3.tsx",
      "parts/AP2112K-3.3/verification.md",
    ])
    expect(await readPart(root, "AP2112K-3.3")).toEqual(LDO)
    const checklist = await readFile(join(root, "parts", "AP2112K-3.3", "verification.md"), "utf8")
    expect(checklist).toContain("Status: not verified")
    expect(checklist).toContain("- [ ] Pin 1 is VIN (power in)")
    expect(checklist).toContain("- [ ] Footprint sot23_5 matches the package drawing")
    expect(await listParts(root)).toEqual([
      { id: "AP2112K-3.3", title: LDO.title, mpn: LDO.mpn, footprint: "sot23_5", component: "AP2112K_3_3", verified: false },
    ])
  })

  test("rejects invalid data with the field that is wrong", async () => {
    const bad = { ...LDO, pins: { "1": { name: "+5V", type: "power_in" } } }
    await expect(createPart(root, "X", bad, { now: NOW })).rejects.toThrow(/pins\.1\.name/)
    await expect(createPart(root, "X", { ...LDO, footprint: 'sot23"><x' }, { now: NOW })).rejects.toThrow(/footprint/)
    await expect(createPart(root, "X", { ...LDO, datasheet: { file: "../secret.pdf" } }, { now: NOW })).rejects.toThrow(/datasheet/)
  })

  test("an existing part is replaced only on request, and a verified part never", async () => {
    await createPart(root, "LDO", LDO, { now: NOW })
    await expect(createPart(root, "LDO", LDO, { now: NOW })).rejects.toThrow(/already exists/)
    await writeFile(join(root, "parts", "LDO", "verification.md"), "stale notes")
    await createPart(root, "LDO", { ...LDO, title: "new title" }, { replace: true, now: NOW })
    expect((await readPart(root, "LDO")).title).toBe("new title")
    expect(await readFile(join(root, "parts", "LDO", "verification.md"), "utf8")).toContain("# Verification of new title")
    await verifyPart(root, "LDO", { by: "Eren", against: "AP2112 datasheet rev 2, p. 2" }, NOW)
    await expect(createPart(root, "LDO", LDO, { replace: true, now: NOW })).rejects.toThrow(/verified/)
  })

  test("verifying records who checked it and against what", async () => {
    await createPart(root, "LDO", LDO, { now: NOW })
    const part = await verifyPart(root, "LDO", { by: "Eren", against: "AP2112 datasheet rev 2, p. 2" }, NOW)
    expect(part.verified).toMatchObject({ by: "Eren", against: "AP2112 datasheet rev 2, p. 2", date: NOW })
    expect(part.verified?.hash).toMatch(/^[0-9a-f]{64}$/)
    expect((await listParts(root))[0]).toMatchObject({ verified: true, verifiedBy: "Eren" })
  })
})

describe("generated component", () => {
  const code = generateComponent("AP2112K-3.3", LDO)

  test("is valid TSX that spreads the caller's props last", () => {
    expect(() => parseSource(code)).not.toThrow()
    expect(code).toContain("export const AP2112K_3_3 = (props: { name: string; [prop: string]: unknown }) => (")
    expect(code.trimEnd().split("\n").slice(-3).join("\n")).toBe("    {...props}\n  />\n)")
  })

  test("carries the footprint, labels, pin types and supplier numbers", () => {
    expect(code).toContain('footprint={"sot23_5"}')
    expect(code).toContain('manufacturerPartNumber={"AP2112K-3.3TRG1"}')
    expect(code).toContain('pinLabels={{"pin1":"VIN","pin2":"GND","pin3":"EN","pin4":"NC","pin5":"VOUT"}}')
    expect(code).toContain('"pin1":{"requiresPower":true}')
    expect(code).toContain('"pin4":{"doNotConnect":true}')
    expect(code).toContain('supplierPartNumbers={{"jlcpcb":["C51118"]}}')
  })

  test("rebuild regenerates every component from part.yaml", async () => {
    await createPart(root, "LDO", LDO, { now: NOW })
    await writeFile(join(root, "parts", "LDO", "LDO.tsx"), "stale")
    expect(await rebuildComponents(root)).toEqual(["parts/LDO/LDO.tsx"])
    expect(await readFile(join(root, "parts", "LDO", "LDO.tsx"), "utf8")).toContain("export const LDO")
  })
})
