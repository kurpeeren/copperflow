// The wizard's stub footprint.yaml says "placeholder: true": the board refuses the part until a person draws its pads,
// the schematic does not.
import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { verifyPart } from "../src/core/library.js"
import { exportFabrication } from "../src/core/fabrication.js"
import { writeNewPart } from "../src/library/new-part.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const NOW = "2026-11-11T09:30:00.000Z"
const PLACEHOLDER = "J3 uses a placeholder footprint; draw its pads in parts/HDR3/footprint.yaml"
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-placeholder-"))
  await writeNewPart(root, { id: "HDR3", title: "3-pin header", package: { file: "footprint.yaml" }, pins: "1 A\n2 B\n3 C" }, { now: NOW })
  await writeFile(
    join(root, "main.circuit.tsx"),
    ['import { HDR3 } from "./parts/HDR3/HDR3"', "export default () => (", '  <board width="20mm" height="12mm">', '    <HDR3 name="J3" pcbX={0} pcbY={0} />', '    <HDR3 name="J4" pcbX={0} pcbY={-4} />', "  </board>", ")", ""].join("\n"),
  )
})

/** Deletes the placeholder line, as a person does after drawing the pads. */
async function drawPads(): Promise<void> {
  const path = join(root, "parts", "HDR3", "footprint.yaml")
  await writeFile(path, (await readFile(path, "utf8")).replace("placeholder: true\n", ""))
}

const errorsOf = (design: Awaited<ReturnType<typeof inProcessEngine.build>>) =>
  [...design.diagnostics, ...design.violations].filter((finding) => finding.severity === "error").map((finding) => finding.message)

describe("a placeholder footprint", () => {
  test("is written with placeholder: true", async () => {
    expect(await readFile(join(root, "parts", "HDR3", "footprint.yaml"), "utf8")).toMatch(/^placeholder: true$/m)
  })

  test("the checks report an error for each use of the part on the board; the schematic still has both parts", async () => {
    const design = await inProcessEngine.build(root, "main.circuit.tsx")
    const placeholder = errorsOf(design).filter((message) => message.includes("placeholder footprint"))
    expect(placeholder).toEqual([expect.stringContaining(PLACEHOLDER), expect.stringContaining("J4 uses a placeholder footprint")])
    expect(design.schematic.symbols.map((symbol) => symbol.component).sort()).toEqual(["J3", "J4"])
    expect(design.pcb.parts.find((part) => part.component === "J3")?.pads).toHaveLength(3)
  })

  test("fabrication export refuses while it is there and writes once it is gone", async () => {
    const refused = await exportFabrication(root, "main.circuit.tsx", { engine: inProcessEngine })
    expect(refused.written).toBe(false)
    expect(!refused.written && refused.errors.join("\n")).toContain(PLACEHOLDER)
    await drawPads()
    const design = await inProcessEngine.build(root, "main.circuit.tsx")
    expect(errorsOf(design)).toEqual([])
    expect((await exportFabrication(root, "main.circuit.tsx", { design })).written).toBe(true)
  })

  test("parts verify refuses the part while it is there and verifies it once it is gone", async () => {
    await expect(verifyPart(root, "HDR3", { by: "Eren", against: "datasheet p. 3" }, NOW)).rejects.toThrow(
      'Part HDR3 cannot be verified: parts/HDR3/footprint.yaml is a placeholder; draw its pads from the datasheet\'s land pattern, then delete "placeholder: true"',
    )
    await drawPads()
    expect((await verifyPart(root, "HDR3", { by: "Eren", against: "datasheet p. 3" }, NOW)).verified?.by).toBe("Eren")
  })
})
