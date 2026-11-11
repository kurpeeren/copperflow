import { describe, expect, test } from "vitest"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyEdits, EditError, readLayoutText, renameDesignators, serializeLayout, undoChange } from "../src/core/index.js"
import { resolveCircuit } from "../src/core/workspace.js"
import { buildDesign } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import type { LayoutRecord } from "../src/core/layout-file.js"

const engine = { build: async (root: string, file: string) => buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), (await resolveCircuit(root, file)).file) }

// R1.pin2 and R3.pin1 share an unnamed net, "net:R1.pin2"; R1.pin1 and R3.pin2 are alone. Swapping R1 and R3 gives
// that net the id "net:R1.pin1", and "net:R1.pin2" becomes the old R3.pin2 alone: copper must follow, not stay put.
const CIRCUIT = `export default () => (
  <board width="20mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-3} pcbY={0} />
    <resistor name="R3" resistance="2k" footprint="0603" pcbX={3} pcbY={0} />
    <trace from="R1.pin2" to="R3.pin1" />
    <copperpour net="net:R1.pin2" layer="bottom" />
  </board>
)
`
const track = (id: string, net: string): LayoutRecord => ({ t: "track", id, net, layer: "top", width: 0.2, points: [{ x: -2, y: 0 }, { x: 2, y: 0 }], locked: false, by: "human" })
const via = (id: string, net: string): LayoutRecord => ({ t: "via", id, net, at: { x: 0, y: 5 }, drill: 0.3, diameter: 0.6, layers: ["top", "bottom"], locked: false, by: "human" })

async function project() {
  const root = await mkdtemp(join(tmpdir(), "cf-rename-"))
  await writeFile(join(root, "main.circuit.tsx"), CIRCUIT)
  const layout = serializeLayout({ next: { track: 2, via: 2 }, records: [track("t0001", "net:R1.pin2"), via("v0001", "net:R3.pin2")] })
  await writeFile(join(root, "main.circuit.layout.json"), layout)
  return { root, layout }
}

/** The pins of the net a record names in a built design, by the parts' values (which stay with the physical parts). */
async function pinsOf(root: string, net: string): Promise<string[]> {
  const design = await engine.build(root, "main.circuit.tsx")
  const found = design.circuit.nets.find((candidate) => candidate.id === net)
  const value = (pin: string) => design.circuit.components.find((c) => c.id === pin.split(".")[0])?.value
  return (found?.pins ?? []).map((pin) => `${value(pin)}.${pin.split(".")[1]}`).sort()
}

describe("Annotate: renaming parts as one change with the layout file", () => {
  test("a swap of two designators keeps every track, via and pour on the copper it was drawn for", async () => {
    const { root } = await project()
    const before = { track: await pinsOf(root, "net:R1.pin2"), via: await pinsOf(root, "net:R3.pin2") }
    const { entry } = await renameDesignators(root, "main.circuit.tsx", [{ from: "R1", to: "R3" }, { from: "R3", to: "R1" }], { author: "human", summary: "annotate", engine })
    expect(entry.also?.map((change) => change.file)).toEqual(["main.circuit.layout.json"])
    const records = readLayoutText(await readFile(join(root, "main.circuit.layout.json"), "utf8")).records
    expect(records.map((record) => record.net)).toEqual(["net:R1.pin1", "net:R1.pin2"])
    expect(await pinsOf(root, "net:R1.pin1")).toEqual(before.track)
    expect(await pinsOf(root, "net:R1.pin2")).toEqual(before.via)
    const text = await readFile(join(root, "main.circuit.tsx"), "utf8")
    expect(text).toContain('<trace from="R3.pin2" to="R1.pin1" />')
    // The pour names the net by its id, which the swap changes: it takes the new id, so it stays on the same copper.
    expect(text).toContain('net="net:R1.pin1"')
    const design = await engine.build(root, "main.circuit.tsx")
    expect(design.pcb.pours?.map((pour) => pour.net)).toEqual(["net:R1.pin1"])
  })

  test("a new name a sub-sheet instance's part already has is refused, and nothing is written", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-rename-"))
    await writeFile(join(root, "Stage.sheet.tsx"), `export default function Stage() {\n  return (\n    <sheet>\n      <port name="IN" />\n      <resistor name="R1" resistance="1k" />\n      <trace from="R1.pin1" to="net.IN" />\n    </sheet>\n  )\n}\n`)
    const source = `import Stage from "./Stage.sheet"\nexport default () => (\n  <board width="20mm" height="20mm">\n    <resistor name="R7" resistance="1k" />\n    <Stage name="S1" connections={{ IN: "VIN" }} base={100} />\n    <trace from="R7.pin1" to="net.VIN" />\n  </board>\n)\n`
    await writeFile(join(root, "main.circuit.tsx"), source)
    await expect(renameDesignators(root, "main.circuit.tsx", [{ from: "R7", to: "R101" }], { author: "human", summary: "annotate", engine })).rejects.toThrow(/R101 is the designator of a part inside a sub-sheet instance/)
    expect(await readFile(join(root, "main.circuit.tsx"), "utf8")).toBe(source)
    await renameDesignators(root, "main.circuit.tsx", [{ from: "R7", to: "R1" }], { author: "human", summary: "annotate", engine })
    expect(await readFile(join(root, "main.circuit.tsx"), "utf8")).toContain('<trace from="R1.pin1" to="net.VIN" />')
  })

  test("the undo takes the circuit and the layout file back together", async () => {
    const { root, layout } = await project()
    await renameDesignators(root, "main.circuit.tsx", [{ from: "R1", to: "R3" }, { from: "R3", to: "R1" }], { author: "human", summary: "annotate", engine })
    await undoChange(root, { author: "human" })
    expect(await readFile(join(root, "main.circuit.tsx"), "utf8")).toBe(CIRCUIT)
    expect(await readFile(join(root, "main.circuit.layout.json"), "utf8")).toBe(layout)
  })
})

describe("the renameParts edit follows every literal reference and refuses hidden ones", () => {
  const WITH_INSTANCE = `import Power from "./Power.sheet"
export default () => (
  <board width="20mm" height="20mm">
    <resistor name="R5" resistance="1k" />
    <Power name="Power1" connections={{ VIN: "R5.pin1" }} />
    <trace from=".R5 > .pin2" to="net.GND" />
  </board>
)
`
  test("a sub-sheet instance's connections and a class-style trace end follow; the instance keeps its name", () => {
    const next = applyEdits(WITH_INSTANCE, [{ kind: "renameParts", mapping: [{ from: "R5", to: "R1" }] }], new Set())
    expect(next).toContain('connections={{ VIN: "R1.pin1" }}')
    expect(next).toContain('<trace from="R1.pin2" to="net.GND" />')
    expect(next).toContain('import Power from "./Power.sheet"')
    expect(next).toContain('name="Power1"')
  })

  test("an expression naming the part is refused, with what and where", () => {
    const source = WITH_INSTANCE.replace('connections={{ VIN: "R5.pin1" }}', "connections={{ VIN: R5pin }} note={R5.label}")
    expect(() => applyEdits(source, [{ kind: "renameParts", mapping: [{ from: "R5", to: "R1" }] }], new Set())).toThrow(EditError)
    expect(() => applyEdits(source, [{ kind: "renameParts", mapping: [{ from: "R5", to: "R1" }] }], new Set())).toThrow(/Power1\.note .*R5/)
  })

  test("a reference inside a locked part, a plain string naming the part and a net id without the design are refused", () => {
    const rename = [{ kind: "renameParts" as const, mapping: [{ from: "R5", to: "R1" }] }]
    expect(() => applyEdits(WITH_INSTANCE, rename, new Set(["Power1"]))).toThrow(/Power1 is locked and names R5\.pin1/)
    expect(() => applyEdits(WITH_INSTANCE.replace("<trace", '<schematictext text="R5" x={0} y={0} />\n    <trace'), rename, new Set())).not.toThrow()
    expect(() => applyEdits(WITH_INSTANCE.replace('resistance="1k"', 'resistance="1k" ref="R5"'), rename, new Set())).toThrow(/names R5 as a plain string/)
    expect(() => applyEdits(WITH_INSTANCE.replace("<trace", '<copperpour net="net:R5.pin1" layer="top" />\n    <trace'), rename, new Set())).toThrow(/needs the built design/)
  })
})
