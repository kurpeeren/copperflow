import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { runCli } from "../src/cli-commands.js"
import { BOARD, SHARED } from "./fixtures.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const CAN = join(import.meta.dirname, "fixtures", "can-module")
/** A circuit the engine builds and exports without errors or warnings: one resistor with its LCSC number, nothing to route. */
const CLEAN = `export default () => (
  <board width="10mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0402" supplierPartNumbers={{ jlcpcb: ["C11702"] }} pcbX={0} pcbY={0} schX={0} schY={0} />
  </board>
)
`
const NAMES = ["F_Cu.gtl", "B_Cu.gbl", "F_Mask.gts", "B_Mask.gbs", "F_Paste.gtp", "B_Paste.gbp", "F_Silkscreen.gto", "B_Silkscreen.gbo", "Edge_Cuts.gm1", "PTH.drl", "NPTH.drl", "pick-and-place.csv", "bom.csv"]

let root: string
let out: string[]
let err: string[]
const run = (...args: string[]) => runCli(args, root, { out: (s) => out.push(s), err: (s) => err.push(s) }, { engine: inProcessEngine })
const exists = (path: string) => stat(join(root, path)).then(
  () => true,
  () => false,
)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-cli-export-"))
  out = []
  err = []
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("copperflow export", () => {
  test("writes <name>-fab/ and <name>-fab.zip beside the circuit, prints the files and the upload step, and exits 0", async () => {
    await mkdir(join(root, "boards"))
    await writeFile(join(root, "boards", "led.circuit.tsx"), CLEAN)
    expect(await run("export", "boards/led.circuit.tsx")).toBe(0)
    expect(err).toEqual([])
    expect(out.join("\n")).toBe(
      [
        "Wrote 13 files to boards/led-fab/ and boards/led-fab.zip:",
        ...NAMES.map((name) => `  led-${name}`),
        "Checks: 0 errors, 2 warnings.",
        "Next, a person should upload led-fab.zip to JLCPCB's PCB order, and led-bom.csv and led-pick-and-place.csv from boards/led-fab/ at its assembly step (the zip holds them too).",
      ].join("\n"),
    )
    expect((await readdir(join(root, "boards", "led-fab"))).sort()).toEqual(NAMES.map((name) => `led-${name}`).sort())
    expect(await exists("boards/led-fab.zip")).toBe(true)
  })

  test("--out writes into that project folder instead", async () => {
    await writeFile(join(root, "led.circuit.tsx"), CLEAN)
    expect(await run("export", "led.circuit.tsx", "--out", "fab/today")).toBe(0)
    expect(out[0]).toMatch(/^Wrote 13 files to fab\/today\/led-fab\/ and fab\/today\/led-fab\.zip:/)
    expect(await exists("fab/today/led-fab.zip")).toBe(true)
    expect(await exists("led-fab.zip")).toBe(false)
  })

  test("prints each warning, such as the connections not routed yet, and still exits 0", async () => {
    await cp(CAN, root, { recursive: true })
    expect(await run("export", "can-module.circuit.tsx")).toBe(0)
    const text = out.join("\n")
    expect(text).toMatch(/^Wrote 13 files to can-module-fab\/ and can-module-fab\.zip:\n {2}can-module-F_Cu\.gtl\n/)
    expect(text).toMatch(/\nWarning: \d+ connections are not routed: /)
    expect(text).toMatch(/\nChecks: \d+ errors?, \d+ warnings?\.( Run check_circuit .*)?\nNext, /)
    expect(text.endsWith("\nNext, a person should upload can-module-fab.zip to JLCPCB's PCB order, and can-module-bom.csv and can-module-pick-and-place.csv from can-module-fab/ at its assembly step (the zip holds them too).")).toBe(true)
  })

  test("a circuit with errors is refused: each error printed, nothing written, exit code 1", async () => {
    await writeFile(join(root, "main.circuit.tsx"), BOARD)
    await writeFile(join(root, "shared.ts"), SHARED)
    expect(await run("export", "main.circuit.tsx")).toBe(1)
    const text = out.join("\n")
    expect(text).toMatch(/^Refused: no fabrication files were written\. Fix these errors first:\n {2}\S/)
    expect(text).toMatch(/RX/)
    expect(await exists("main-fab")).toBe(false)
    expect(await exists("main-fab.zip")).toBe(false)
  })

  test("a missing file or a folder outside the project is an error with exit code 1", async () => {
    expect(await run("export")).toBe(1)
    expect(err.at(-1)).toMatch(/Missing file/)
    await writeFile(join(root, "led.circuit.tsx"), CLEAN)
    expect(await run("export", "led.circuit.tsx", "--out", "../elsewhere")).toBe(1)
    expect(err.at(-1)).toMatch(/outside the project root/)
    expect(await run("export", "nothing.circuit.tsx")).toBe(1)
    expect(err.at(-1)).toMatch(/does not exist/)
  })

  test("help names the command", async () => {
    expect(await run("help")).toBe(0)
    expect(out.join("\n")).toContain("copperflow export <file> [--out dir]")
    expect(out.join("\n")).toContain("export exits with 1 when the circuit has errors")
  })
})

describe("copperflow export keeps to the project", () => {
  let outside: string
  beforeEach(async () => {
    outside = await mkdtemp(join(tmpdir(), "cf-cli-outside-"))
    await writeFile(join(root, "led.circuit.tsx"), CLEAN)
  })
  afterEach(async () => {
    await rm(outside, { recursive: true, force: true })
  })
  /** A junction on Windows (no rights needed), a folder symlink elsewhere. */
  const link = (target: string, path: string) => symlink(target, join(root, path), "junction")

  test("--out through a link to a folder outside the project is refused and writes nothing there", async () => {
    await link(outside, "away")
    expect(await run("export", "led.circuit.tsx", "--out", "away")).toBe(1)
    expect(err.at(-1)).toMatch(/away is outside the project root/)
    expect(await run("export", "led.circuit.tsx", "--out", "away/deeper")).toBe(1)
    expect(err.at(-1)).toMatch(/away\/deeper is outside the project root/)
    expect(await readdir(outside)).toEqual([])
  })

  test("a <name>-fab folder that is a link to outside is refused, so neither the files nor the stale-file removal reach there", async () => {
    await writeFile(join(outside, "led-In1_Cu.g2"), "not the project's")
    await link(outside, "led-fab")
    expect(await run("export", "led.circuit.tsx")).toBe(1)
    expect(err.at(-1)).toMatch(/led-fab is outside the project root/)
    expect(await readdir(outside)).toEqual(["led-In1_Cu.g2"])
    expect(await exists("led-fab.zip")).toBe(false)
  })

  test("a file where the <name>-fab folder goes is reported in plain words, exit code 1", async () => {
    await writeFile(join(root, "led-fab"), "mine")
    expect(await run("export", "led.circuit.tsx")).toBe(1)
    expect(err.at(-1)).toBe("copperflow: Cannot write the fabrication files: led-fab is in the way (a file where a folder goes); move or rename it")
    expect(await readFile(join(root, "led-fab"), "utf8")).toBe("mine")
  })

  test("a file of a person's own inside <name>-fab/ survives the export", async () => {
    await mkdir(join(root, "led-fab"))
    await writeFile(join(root, "led-fab", "order-notes.txt"), "4 boards, green")
    expect(await run("export", "led.circuit.tsx")).toBe(0)
    expect(await readFile(join(root, "led-fab", "order-notes.txt"), "utf8")).toBe("4 boards, green")
    expect(await readdir(join(root, "led-fab"))).toHaveLength(14)
  })
})
