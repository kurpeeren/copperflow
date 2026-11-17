import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { afterEach, beforeAll, describe, expect, test } from "vitest"
import { buildBom, type BomLine } from "../../src/core/bom.js"
import { buildDesign, type Design } from "../../src/engine/design.js"
import { fabricationSet, writeFabrication, type FabricationSet } from "../../src/engine/fab/export.js"
import type { PcbVia } from "../../src/engine/pcb.js"
import { readZip } from "../helpers/zip-read.js"

const FOLDER = join(import.meta.dirname, "..", "fixtures", "can-module")
const MAIN = "can-module.circuit.tsx"
const CREATED = new Date(Date.UTC(2026, 10, 10, 12, 0, 0))

function filesIn(folder: string): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else files[relative(folder, path).split("\\").join("/")] = readFileSync(path, "utf8")
    }
  }
  walk(folder)
  return files
}

const NAMES = [
  "F_Cu.gtl",
  "B_Cu.gbl",
  "F_Mask.gts",
  "B_Mask.gbs",
  "F_Paste.gtp",
  "B_Paste.gbp",
  "F_Silkscreen.gto",
  "B_Silkscreen.gbo",
  "Edge_Cuts.gm1",
  "PTH.drl",
  "NPTH.drl",
  "pick-and-place.csv",
  "bom.csv",
].map((name) => `can-module-${name}`).concat("can-module.step")

let design: Design
let bom: BomLine[]
const temps: string[] = []

beforeAll(async () => {
  design = buildDesign(filesIn(FOLDER), MAIN)
  bom = await buildBom(FOLDER, MAIN, { design })
})

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
})

const accepted = (result: ReturnType<typeof fabricationSet>): FabricationSet => {
  if (!result.ok) throw new Error(`refused: ${result.errors.join("; ")}`)
  return result
}

describe("the fabrication set", () => {
  test("holds the Gerbers, the two drill files, the pick-and-place and the BOM, named for the design", () => {
    const set = accepted(fabricationSet(design, bom, CREATED))
    expect(set.folder).toBe("can-module-fab")
    expect(set.zip).toBe("can-module-fab.zip")
    expect(set.files.map((f) => f.file)).toEqual(NAMES)
    const pnp = set.files.find((f) => f.file === "can-module-pick-and-place.csv")?.text ?? ""
    expect(pnp.trimEnd().split("\n")).toHaveLength(13)
    expect(pnp).toContain("\nU1,-7mm,2mm,Top,0\n")
    expect(pnp).toContain("\nU2,8mm,2mm,Top,270\n")
    const csv = set.files.find((f) => f.file === "can-module-bom.csv")?.text ?? ""
    expect(csv.split("\n")[0]).toBe("Comment,Designator,Footprint,LCSC Part #")
    expect(csv).toMatch(/\n[^\n]*,U1,[^\n]*,C9657\n/)
  })

  test("a board with unrouted connections is exported with a warning that names each of them", () => {
    const set = accepted(fabricationSet(design, bom, CREATED))
    expect(design.pcb.ratsnest.length).toBeGreaterThan(0)
    expect(set.warnings).toHaveLength(2)
    expect(set.warnings[0]).toMatch(new RegExp(`^${design.pcb.ratsnest.length} connections are not routed: `))
    for (const line of design.pcb.ratsnest) expect(set.warnings[0]).toContain(`${line.from} to ${line.to}`)
  })

  test("a board with an error is refused, naming each error; warnings alone do not refuse it", () => {
    const withError: Design = {
      ...design,
      diagnostics: [...design.diagnostics, { code: "layout-file", severity: "error", message: "can-module.circuit.layout.json: line 3 is not JSON", items: [] }],
      violations: [...design.violations, { id: "short:GND,VCC", code: "short", severity: "error", message: "GND and VCC are joined", items: ["GND", "VCC"], view: "pcb" }],
    }
    const refused = fabricationSet(withError, bom, CREATED)
    expect(refused).toEqual({
      ok: false,
      errors: ["layout-file: can-module.circuit.layout.json: line 3 is not JSON", "short: GND and VCC are joined (GND, VCC)"],
    })
    expect(design.violations.some((v) => v.severity === "warning")).toBe(true)
    expect(fabricationSet(design, bom, CREATED).ok).toBe(true)
  })
})

describe("what the fabrication set refuses or warns about", () => {
  const fourLayers = (vias: PcbVia[]): Design => ({
    ...design,
    pcb: { ...design.pcb, board: { ...(design.pcb.board as NonNullable<Design["pcb"]["board"]>), layers: 4 }, vias: [...design.pcb.vias, ...vias] },
  })
  const via = (id: string, layers: PcbVia["layers"]): PcbVia => ({ id, at: { x: 0, y: 0 }, drill: 0.3, diameter: 0.6, layers, locked: false, by: "human" })

  test("a blind or buried via is refused, naming the layers it spans in stack order; a through via is not", () => {
    const refused = fabricationSet(fourLayers([via("v0007", ["inner1", "top"]), via("v0008", ["inner1", "inner2"]), via("v0009", ["top", "inner2", "bottom"])]), bom, CREATED)
    expect(refused).toEqual({
      ok: false,
      errors: [
        "blind or buried vias cannot be made as through drills; v0007 spans top–inner1",
        "blind or buried vias cannot be made as through drills; v0008 spans inner1–inner2",
      ],
    })
    expect(fabricationSet(fourLayers([via("v0009", ["bottom", "top"])]), bom, CREATED).ok).toBe(true)
  })

  test("a part without a footprint is named in a warning, since the pick-and-place leaves it out", () => {
    const parts = design.pcb.parts.map((part) => (part.component === "U1" || part.component === "C2" ? { ...part, footprint: undefined } : part))
    const set = accepted(fabricationSet({ ...design, pcb: { ...design.pcb, parts } }, bom, CREATED))
    expect(set.warnings).toContain("2 parts have no footprint and are not in the pick-and-place: C2, U1")
    const one = design.pcb.parts.map((part) => (part.component === "U1" ? { ...part, footprint: undefined } : part))
    expect(accepted(fabricationSet({ ...design, pcb: { ...design.pcb, parts: one } }, bom, CREATED)).warnings).toContain("1 part has no footprint and is not in the pick-and-place: U1")
    expect(accepted(fabricationSet(design, bom, CREATED)).warnings.some((w) => w.includes("footprint"))).toBe(false)
  })

  test("one warning names every part with no LCSC part number, which JLCPCB's assembly cannot match", () => {
    const set = accepted(fabricationSet(design, bom, CREATED))
    expect(set.warnings).toContain("No LCSC part number for C1, C2, C3, C4, J1, J2, J3, R1, R2, Y1; JLCPCB assembly will not match them")
    const one = bom.map((line) => ({ ...line, supplier: line.designators.includes("U1") ? "digikey 1" : "jlcpcb C1" }))
    expect(accepted(fabricationSet(design, one, CREATED)).warnings).toContain("No LCSC part number for U1; JLCPCB assembly will not match it")
    const all = bom.map((line) => ({ ...line, supplier: "lcsc C1" }))
    expect(accepted(fabricationSet(design, all, CREATED)).warnings.some((w) => w.includes("LCSC"))).toBe(false)
  })

  test("a designator a person put over another part's pads is named in a warning, and keeps its place", () => {
    const u1 = design.pcb.parts.find((part) => part.component === "U1")?.pads.find((pad) => pad.number === "9")
    if (u1 === undefined) throw new Error("no U1 pad 9")
    const parts = design.pcb.parts.map((part) => (part.component === "C1" ? { ...part, nameAt: { x: u1.x, y: u1.y } } : part))
    const set = accepted(fabricationSet({ ...design, pcb: { ...design.pcb, parts } }, bom, CREATED))
    // On U1's pads it lies on U1's courtyard too, and the warning says both.
    expect(set.warnings).toContain("C1's silkscreen overlaps U1's pads and U1's courtyard")
    expect(accepted(fabricationSet(design, bom, CREATED)).warnings.some((w) => w.includes("silkscreen"))).toBe(false)
  })
})

describe("writing the fabrication set", () => {
  test("writes the folder and the zip beside each other; the zip holds the same files in the same order, the same bytes on a second run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "copperflow-fab-"))
    temps.push(dir)
    const set = accepted(fabricationSet(design, bom, CREATED))
    const written = await writeFabrication(dir, set)
    expect(written).toEqual({ folder: join(dir, "can-module-fab"), zip: join(dir, "can-module-fab.zip"), files: NAMES.map((name) => join(dir, "can-module-fab", name)) })
    expect((await readdir(join(dir, "can-module-fab"))).sort()).toEqual([...NAMES].sort())
    expect(await readFile(join(dir, "can-module-fab", "can-module-PTH.drl"), "utf8")).toBe(set.files[9]?.text)
    const zip = await readFile(written.zip)
    const entries = readZip(zip)
    expect(entries.map((e) => e.name)).toEqual(NAMES)
    expect(entries.map((e) => e.data.toString("utf8"))).toEqual(set.files.map((f) => f.text))
    expect(entries[0]?.modified).toEqual({ year: 2026, month: 11, day: 10, hours: 12, minutes: 0, seconds: 0 })

    await writeFabrication(dir, accepted(fabricationSet(design, bom, CREATED)))
    expect((await readFile(written.zip)).equals(zip)).toBe(true)
  })

  test("a file of an earlier export that this one does not write is removed; other files in the folder are kept", async () => {
    const dir = await mkdtemp(join(tmpdir(), "copperflow-fab-"))
    temps.push(dir)
    await mkdir(join(dir, "can-module-fab"))
    await writeFile(join(dir, "can-module-fab", "can-module-In1_Cu.g2"), "old")
    await writeFile(join(dir, "can-module-fab", "notes.txt"), "mine")
    await writeFabrication(dir, accepted(fabricationSet(design, bom, CREATED)))
    const listing = await readdir(join(dir, "can-module-fab"))
    expect(listing).not.toContain("can-module-In1_Cu.g2")
    expect(listing).toContain("notes.txt")
  })
})
