// The importer with a fetch that answers from copperflow's own EasyEDA-format fixtures: never the network.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listParts, readPart, rebuildComponents } from "../src/core/library.js"
import { formatImport, importLcscPart, lcscEndpoint, MAX_ANSWER_BYTES } from "../src/library/import-lcsc.js"
import { ORIENTATION_NOTE } from "../src/library/lcsc-part.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { fixtureFetch, lcscFixture, noNetwork, offlineFetch as offline } from "./helpers/lcsc-fixtures.js"

const NOW = "2026-11-11T09:30:00.000Z"
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-lcsc-"))
  vi.stubGlobal("fetch", noNetwork)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const partsFolder = async () => readdir(join(root, "parts")).catch(() => [])

describe("importing by LCSC number", () => {
  test("writes the part, its footprint, the component, the checklist and the source, unverified", async () => {
    const get = fixtureFetch()
    const result = await importLcscPart(root, "c7950", { now: NOW, fetch: get })
    expect(get.calls).toEqual([lcscEndpoint("C7950")])
    expect(get.calls[0]).toBe("https://easyeda.com/api/products/C7950/components?version=6.4.19.5")
    expect(result.id).toBe("LM358DR2G")
    expect(result.files).toEqual([
      "parts/LM358DR2G/part.yaml",
      "parts/LM358DR2G/footprint.yaml",
      "parts/LM358DR2G/LM358DR2G.tsx",
      "parts/LM358DR2G/verification.md",
      "parts/LM358DR2G/source.md",
    ])
    const part = await readPart(root, "LM358DR2G")
    expect(part.origin).toBe("lcsc C7950, imported 2026-11-11")
    expect(part.verified).toBeUndefined()
    expect(await listParts(root)).toEqual([
      expect.objectContaining({ id: "LM358DR2G", verified: false, origin: "lcsc C7950, imported 2026-11-11", footprint: "footprint.yaml" }),
    ])
    const checklist = await readFile(join(root, "parts", "LM358DR2G", "verification.md"), "utf8")
    expect(checklist).toContain("Status: not verified")
    expect(checklist).toContain("- [ ] Pin 1 is _1OUT (passive)")
    expect(checklist).toContain("- [ ] Every pad in footprint.yaml matches the recommended land pattern")
    expect(checklist).toContain("- [ ] lcsc part C7950 is this exact part")
    expect(checklist).toContain("(lcsc C7950, imported 2026-11-11; nothing from the source has been checked)")
    const source = await readFile(join(root, "parts", "LM358DR2G", "source.md"), "utf8")
    expect(source).toContain("JLCEDA/EasyEDA Official Library: https://lceda.cn/ and https://easyeda.com")
    expect(source).toContain("> Test document written for copperflow in EasyEDA's format")
    expect(source).toContain("personal, non-commercial use only")
    for (const name of await readdir(join(root, "parts", "LM358DR2G"))) {
      expect(await readFile(join(root, "parts", "LM358DR2G", name), "utf8"), name).not.toContain("\r")
    }
  })

  test("the approximations go into verification.md as items to check", async () => {
    const answer = lcscFixture("C158012") as { result: { packageDetail: { dataStr: { shape: string[] } } } }
    answer.result.packageDetail.dataStr.shape.push("HOLE~4000~3010~2~h~0")
    const get = (async () => new Response(JSON.stringify(answer))) as typeof fetch
    const result = await importLcscPart(root, "C158012", { now: NOW, fetch: get, id: "XH2" })
    expect(result.notes).toEqual(["An unplated hole of 1.016 mm at (0, -2.54) is not in footprint.yaml; add it to the board as a hole.", ORIENTATION_NOTE])
    const checklist = await readFile(join(root, "parts", "XH2", "verification.md"), "utf8")
    expect(checklist).toContain("## Notes\n\n- [ ] An unplated hole of 1.016 mm")
    expect(formatImport(result)).toContain("Note: An unplated hole")
  })

  test("the footprint's orientation is stated: in the notes, verification.md and the answer", async () => {
    expect(ORIENTATION_NOTE).toBe("The footprint keeps the source's orientation; place at pcbRotation -90 to match a generated footprint of the same package.")
    const result = await importLcscPart(root, "C7950", { now: NOW, fetch: fixtureFetch() })
    expect(result.notes).toContain(ORIENTATION_NOTE)
    const checklist = await readFile(join(root, "parts", "LM358DR2G", "verification.md"), "utf8")
    expect(checklist).toContain(`- [ ] ${ORIENTATION_NOTE}`)
    expect(formatImport(result)).toContain(`Note: ${ORIENTATION_NOTE}`)
  })

  test("the datasheet link is LCSC's, built from the number: verification.md asks for the manufacturer's", async () => {
    await importLcscPart(root, "C7950", { now: NOW, fetch: fixtureFetch() })
    const checklist = await readFile(join(root, "parts", "LM358DR2G", "verification.md"), "utf8")
    expect(checklist).toContain(
      "- [ ] The datasheet link https://www.lcsc.com/datasheet/C7950.pdf was built from the LCSC number, not read from the source: replace it in part.yaml with the manufacturer's datasheet link for this exact part",
    )
  })

  test("all three parts pass parts build and build in a circuit with their pads", async () => {
    const get = fixtureFetch()
    for (const lcsc of ["C7950", "C2838500", "C158012"]) await importLcscPart(root, lcsc, { now: NOW, fetch: get })
    expect(await rebuildComponents(root)).toEqual(["parts/B2B-XH-A_LF_SN/B2B_XH_A_LF_SN.tsx", "parts/ESP32-C3/ESP32_C3.tsx", "parts/LM358DR2G/LM358DR2G.tsx"])
    await writeFile(
      join(root, "main.circuit.tsx"),
      [
        'import { LM358DR2G } from "./parts/LM358DR2G/LM358DR2G"',
        'import { ESP32_C3 } from "./parts/ESP32-C3/ESP32_C3"',
        'import { B2B_XH_A_LF_SN } from "./parts/B2B-XH-A_LF_SN/B2B_XH_A_LF_SN"',
        "export default () => (",
        '  <board width="40mm" height="30mm">',
        '    <LM358DR2G name="U1" pcbX={-10} pcbY={0} />',
        '    <ESP32_C3 name="U2" pcbX={5} pcbY={0} />',
        '    <B2B_XH_A_LF_SN name="J1" pcbX={14} pcbY={8} />',
        '    <trace from="U1.pin4" to="U2.pin33" />',
        '    <trace from="J1.pin1" to="U1.pin8" />',
        "  </board>",
        ")",
        "",
      ].join("\n"),
    )
    const design = await inProcessEngine.build(root, "main.circuit.tsx")
    const pads = (name: string) => design.pcb.parts.find((part) => part.component === name)?.pads ?? []
    expect(pads("U1")).toHaveLength(8)
    expect(pads("U2")).toHaveLength(33)
    expect(pads("J1").map((pad) => pad.layers)).toEqual(["through", "through"])
  })
})

describe("refusals: nothing is written", () => {
  test("offline, the message says so", async () => {
    await expect(importLcscPart(root, "C7950", { now: NOW, fetch: offline })).rejects.toThrow(
      "Could not reach easyeda.com to fetch C7950 (ENOTFOUND). Importing needs an internet connection; nothing was written.",
    )
    expect(await partsFolder()).toEqual([])
  })

  test("a part EasyEDA does not have, a server error and a page that is not JSON", async () => {
    await expect(importLcscPart(root, "C1", { now: NOW, fetch: fixtureFetch() })).rejects.toThrow("Cannot import C1: EasyEDA has no part C1. Nothing was written.")
    const failing = (async () => new Response("busy", { status: 503 })) as typeof fetch
    await expect(importLcscPart(root, "C7950", { now: NOW, fetch: failing })).rejects.toThrow(/answered 503/)
    const html = (async () => new Response("<html>")) as typeof fetch
    await expect(importLcscPart(root, "C7950", { now: NOW, fetch: html })).rejects.toThrow(/could not be read/)
    expect(await partsFolder()).toEqual([])
  })

  test("a server that does not answer in time is not called offline", async () => {
    const slow = (async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError")
    }) as typeof fetch
    await expect(importLcscPart(root, "C7950", { now: NOW, fetch: slow })).rejects.toThrow("easyeda.com did not answer within 20 s for C7950; nothing was written. Try again later.")
    expect(await partsFolder()).toEqual([])
  })

  test("an answer larger than the limit is refused, by its stated length or as read", async () => {
    const stated = (async () => new Response("{}", { headers: { "content-length": String(MAX_ANSWER_BYTES + 1) } })) as typeof fetch
    await expect(importLcscPart(root, "C7950", { now: NOW, fetch: stated })).rejects.toThrow(/could not be read \(larger than 4 MB\)/)
    const huge = (async () => new Response(" ".repeat(MAX_ANSWER_BYTES + 1))) as typeof fetch
    await expect(importLcscPart(root, "C7950", { now: NOW, fetch: huge })).rejects.toThrow(/larger than 4 MB/)
    expect(await partsFolder()).toEqual([])
  })

  test("a part the library refuses after conversion leaves no folder behind", async () => {
    const answer = lcscFixture("C158012") as { result: { packageDetail: { dataStr: { shape: string[] } } } }
    answer.result.packageDetail.dataStr.shape.push("PAD~RECT~4000~3010~0~4~1~~2~0~~0~g~0~~Y~0")
    const get = (async () => new Response(JSON.stringify(answer))) as typeof fetch
    await expect(importLcscPart(root, "C158012", { now: NOW, fetch: get })).rejects.toThrow(/^Cannot import C158012: .*width.*Nothing was written\.$/s)
    expect(await partsFolder()).toEqual([])
  })

  test("a bad LCSC number is refused before any fetch", async () => {
    const get = fixtureFetch()
    await expect(importLcscPart(root, "7950", { now: NOW, fetch: get })).rejects.toThrow(/not an LCSC part number/)
    expect(get.calls).toEqual([])
  })

  test("an existing part id is refused unless replace; a named id is checked before fetching", async () => {
    const get = fixtureFetch()
    await importLcscPart(root, "C7950", { now: NOW, fetch: get })
    await expect(importLcscPart(root, "C7950", { now: NOW, fetch: get })).rejects.toThrow("Part LM358DR2G already exists; import again with replace (--replace) to overwrite it, or choose another id")
    await expect(importLcscPart(root, "C2838500", { now: NOW, fetch: get, id: "LM358DR2G" })).rejects.toThrow(/already exists/)
    expect(get.calls).toHaveLength(2)
    const again = await importLcscPart(root, "C7950", { now: "2026-11-12T08:00:00.000Z", fetch: get, replace: true })
    expect(again.part.origin).toBe("lcsc C7950, imported 2026-11-12")
  })

})
