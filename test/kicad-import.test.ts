import { access, copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, test } from "vitest"
import { listEntries, undoChange } from "../src/core/index.js"
import { buildWith } from "../src/core/design-source.js"
import { formatKicadImport, importKicad } from "../src/library/kicad/import.js"
import { runCli } from "../src/cli-commands.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { shortTempDir } from "./helpers/short-temp.js"

const FIXTURES = fileURLToPath(new URL("./fixtures/kicad", import.meta.url))
const meta = { author: "human" as const, engine: inProcessEngine }
let root: string

interface PadRow {
  ref: string
  number: string
  x: number
  y: number
  angle: number
  width: number
  height: number
  drill: number
  plated: boolean
  net: string
}

const exists = (path: string) => access(path).then(() => true, () => false)
const entries = async () => (await listEntries(root, 1000)).length

beforeEach(async () => {
  root = await shortTempDir("cf-kicad-")
  await mkdir(join(root, "boards"))
  for (const name of ["fixture.kicad_pcb", "fixture.pads.json", "older-v6.kicad_pcb", "older-v6.pads.json"]) await copyFile(join(FIXTURES, name), join(root, "boards", name))
})

/** Every pad of the file against the built design: place, size, turn, drill and net. */
async function comparePads(circuit: string, fixture: string, offset: { x: number; y: number }, netNames: Record<string, string>): Promise<void> {
  const rows = (JSON.parse(await readFile(join(root, "boards", `${fixture}.pads.json`), "utf8")) as PadRow[]).filter((row) => row.plated)
  const design = await buildWith(root, circuit, inProcessEngine)
  const pads = design.pcb.parts.flatMap((part) => part.pads)
  const nets = design.circuit?.nets ?? []
  const netOf = new Map<string, string | undefined>()
  for (const row of rows) {
    const label = `${row.ref}.${row.number}`
    const [x, y] = [row.x + offset.x, -row.y + offset.y]
    const pad = pads.find((p) => p.component === row.ref && Math.hypot(p.x - x, p.y - y) < 0.001)
    expect(pad, `${label} at (${x}, ${y})`).toBeDefined()
    if (!pad) continue
    expect(pad.number, label).toBe(row.number)
    expect([pad.width, pad.height], label).toEqual([row.width, row.height])
    if (pad.shape !== "circle") expect(((pad.rotation - row.angle) % 180 + 180) % 180 < 1e-6 || ((pad.rotation - row.angle) % 180 + 180) % 180 > 180 - 1e-6, `${label} turn ${pad.rotation} vs ${row.angle}`).toBe(true)
    expect(pad.drill?.width ?? 0, label).toBeCloseTo(row.drill, 6)
    netOf.set(label, pad.net)
    if (row.net !== "" && !row.net.startsWith("Net-(") && !row.net.startsWith("unconnected-(")) {
      expect(nets.find((n) => n.id === pad.net)?.names ?? [], label).toContain(netNames[row.net])
    }
  }
  // Pads that shared a net in the file share one in the design, and pads of different nets do not.
  for (const a of rows) {
    for (const b of rows) {
      const [na, nb] = [netOf.get(`${a.ref}.${a.number}`), netOf.get(`${b.ref}.${b.number}`)]
      const together = a.net !== "" && a.net === b.net && !a.net.startsWith("unconnected-(")
      if (together) expect(na, `${a.ref}.${a.number} and ${b.ref}.${b.number} share ${a.net}`).toBe(nb)
      else if (a !== b && na !== undefined && nb !== undefined) expect(na === nb, `${a.ref}.${a.number} (${a.net}) and ${b.ref}.${b.number} (${b.net})`).toBe(false)
    }
  }
}

describe("importing the board saved by KiCad 10", () => {
  test("writes the circuit, its copper and its parts as one change, and every pad comes over with its net", async () => {
    const before = await entries()
    const result = await importKicad(root, { kicad: "boards/fixture.kicad_pcb" }, meta)
    expect(await entries()).toBe(before + 1)
    expect(result.file).toBe("fixture.circuit.tsx")
    expect(await exists(join(root, "fixture.circuit.layout.json"))).toBe(true)
    expect(result.padErrors).toEqual([])
    await comparePads("fixture.circuit.tsx", "fixture", { x: -125, y: 120 }, result.netNames)
  })

  test("one library part per land pattern, pin list and value, never verified, with the file as its origin", async () => {
    const result = await importKicad(root, { kicad: "boards/fixture.kicad_pcb" }, meta)
    expect(result.parts.map((p) => `${p.id}: ${p.used.join(" ")}`)).toEqual([
      "CONN3_fixture: J1",
      "ODD3_fixture: U1 U2 U3 U4 U5 U6 U7 U8 U9 U10",
      "R_fixture_1608-10k: R1 R2",
      "R_fixture_1608-1k: R3",
    ])
    const yaml = await readFile(join(root, "parts", "ODD3_fixture", "part.yaml"), "utf8")
    expect(yaml).toContain("origin: kicad fixture.kicad_pcb")
    expect(yaml).toContain("name: IN")
    expect(yaml).not.toContain("verified")
    expect(await readFile(join(root, "parts", "R_fixture_1608-1k", "part.yaml"), "utf8")).toContain("title: 1k")
    const checklist = await readFile(join(root, "parts", "ODD3_fixture", "verification.md"), "utf8")
    expect(checklist).toContain("Status: not verified")
    expect(checklist).toContain("This part came from an import of fixture.kicad_pcb: compare every pad with the datasheet")
  })

  test("answers what it wrote against what the file held, the check, and what did not come over", async () => {
    const result = await importKicad(root, { kicad: "boards/fixture.kicad_pcb" }, meta)
    const lines = formatKicadImport(result)
    expect(lines[0]).toBe(`Change ${result.entry.id}: imported fixture.kicad_pcb (KiCad file version 20260206) as fixture.circuit.tsx, its layout file and 4 new library parts`)
    expect(lines).toContain("Board: 50 x 40 mm, moved by -125, 120; 1 hole: 3.2 mm at (-21, -16) (H1 became a hole)")
    expect(lines).toContain("Parts: 14 of 15 footprints, as 4 library parts")
    expect(lines).toContain("Nets: 3 named and 1 without a name, of 4 in the file")
    expect(lines.find((l) => l.startsWith("Tracks: "))).toMatch(/^Tracks: 4 of 4 \(3 segments; 1 arc as \d+ straight pieces within 0\.01 mm\); vias: 1 of 1; pours: 1 from 1 zone$/)
    expect(lines.find((l) => l.startsWith("Check: "))).toMatch(/^Check: \d+ errors?, \d+ warnings?/)
    expect(lines).toContain("Pads: all 49 copper pads have the net they had in the file")
    expect(lines).toContain("Not carried over:")
    expect(lines).toContain("- 1 net classes and design rules")
    expect(lines.at(-1)).toBe("The parts are NOT verified: they came from the file. Compare every pad with its datasheet (parts/<id>/verification.md).")
  })

  test("undo takes back the circuit, the layout file and the parts", async () => {
    await mkdir(join(root, "parts"))
    const result = await importKicad(root, { kicad: "boards/fixture.kicad_pcb" }, meta)
    await undoChange(root, { author: "human", id: result.entry.id })
    expect(await exists(join(root, "fixture.circuit.tsx"))).toBe(false)
    expect(await exists(join(root, "fixture.circuit.layout.json"))).toBe(false)
    expect(await readdir(join(root, "parts"))).toEqual([])
  })

  test("a second import reuses the parts it wrote and writes no new ones", async () => {
    await importKicad(root, { kicad: "boards/fixture.kicad_pcb" }, meta)
    const again = await importKicad(root, { kicad: "boards/fixture.kicad_pcb", name: "second" }, meta)
    expect(formatKicadImport(again)[0]).toBe(`Change ${again.entry.id}: imported fixture.kicad_pcb (KiCad file version 20260206) as second.circuit.tsx, its layout file and 0 new library parts (4 already in the library)`)
    expect(again.parts.every((p) => !p.written)).toBe(true)
    expect((await readdir(join(root, "parts"))).sort()).toEqual(["CONN3_fixture", "ODD3_fixture", "R_fixture_1608-10k", "R_fixture_1608-1k"])
  })
})

describe("refusals: nothing is written", () => {
  const refused = async (options: Parameters<typeof importKicad>[1], extra: Partial<Parameters<typeof importKicad>[2]> = {}) => {
    const before = await entries()
    const error = await importKicad(root, options, { ...meta, ...extra }).then(() => undefined, (e: Error) => e.message)
    expect(await entries()).toBe(before)
    return error
  }

  test("an existing circuit of the same name without replace", async () => {
    await importKicad(root, { kicad: "boards/fixture.kicad_pcb" }, meta)
    expect(await refused({ kicad: "boards/fixture.kicad_pcb" })).toBe("fixture.circuit.tsx already exists; pass replace to overwrite it, or choose another name")
  })

  test("a path outside the project folder, when only the project is given", async () => {
    expect(await refused({ kicad: "../elsewhere.kicad_pcb" }, { inProject: true })).toBe("../elsewhere.kicad_pcb is outside the project folder")
  })

  test("a file that is not a KiCad board, and one too large", async () => {
    await writeFile(join(root, "boards", "notes.kicad_pcb"), "(kicad_sch (version 20250114))")
    expect(await refused({ kicad: "boards/notes.kicad_pcb" })).toBe("notes.kicad_pcb: This is not a KiCad board: the file starts with (kicad_sch, not (kicad_pcb")
    await writeFile(join(root, "boards", "huge.kicad_pcb"), Buffer.alloc(33 * 1024 * 1024, 32))
    expect(await refused({ kicad: "boards/huge.kicad_pcb" })).toBe("huge.kicad_pcb is 33 MB; copperflow reads KiCad boards of up to 32 MB")
    expect(await exists(join(root, "parts"))).toBe(false)
  })
})

describe("a board written by hand in the layout KiCad 6 saved", () => {
  test("numbered nets, a custom and a trapezoid pad, an inner-layer track and unknown tokens come over or are named", async () => {
    const result = await importKicad(root, { kicad: "boards/older-v6.kicad_pcb", name: "older" }, meta)
    expect(result.padErrors).toEqual([])
    await comparePads("older.circuit.tsx", "older-v6", { x: result.board.board.offset.x, y: result.board.board.offset.y }, result.netNames)
    expect(result.netNames).toEqual({ GND: "GND", "+5V": "P5V", "/sense": "sense" })
    const lines = formatKicadImport(result)
    const left = lines.slice(lines.indexOf("Not carried over:") + 1, -1)
    expect(left).toEqual([
      "- 6 silkscreen and fabrication drawings",
      "- 2 texts",
      "- 1 dimensions",
      "- 1 3D models",
      "- 1 net classes and design rules",
      "- 1 keepout zones with rules copperflow has no like for (kept clear on every layer instead)",
      "- 1 teardrops",
      "- 2 pads with a shape copperflow does not draw, drawn as the nearest shape it has: Q1.1 (custom as rect), Q1.2 (trapezoid as rect)",
      "- 1 tracks on inner layers",
      "- not understood, skipped: (mystery_token) 2 times, (target) 1 time",
    ])
  })
})

describe("copperflow import kicad", () => {
  test("imports a board given by a path from where the command runs, with --name", async () => {
    const out: string[] = []
    const io = { out: (text: string) => out.push(text), err: (text: string) => out.push(text) }
    const code = await runCli(["import", "kicad", "boards/fixture.kicad_pcb", "--name", "main"], root, io, { engine: inProcessEngine })
    expect(out.join("\n").split("\n")[0]).toMatch(/^Change c\d+: imported fixture\.kicad_pcb \(KiCad file version 20260206\) as main\.circuit\.tsx/)
    expect(code).toBe(0)
    expect(await exists(join(root, "main.circuit.tsx"))).toBe(true)
  })

  test("says how it is used when the path is missing or the kind is not kicad", async () => {
    const out: string[] = []
    const io = { out: (text: string) => out.push(text), err: (text: string) => out.push(text) }
    expect(await runCli(["import", "eagle", "x.brd"], root, io)).toBe(1)
    expect(await runCli(["import", "kicad"], root, io)).toBe(1)
    expect(out).toEqual([
      "copperflow: import reads kicad boards only. Usage: copperflow import kicad <board.kicad_pcb> [--name <circuit name>] [--replace] [--origin keep]",
      "copperflow: Missing the KiCad board (.kicad_pcb). Usage: copperflow import kicad <board.kicad_pcb> [--name <circuit name>] [--replace] [--origin keep]",
    ])
  })
})
