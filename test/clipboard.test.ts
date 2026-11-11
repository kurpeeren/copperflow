import { describe, expect, test } from "vitest"
import { analyzeCircuit, applyEdits } from "../src/core/index.js"
import { copyParts, pasteEdits, pasteNames, pasteShift, PASTE_OFFSET } from "../studio/src/shell/clipboard.js"
import { keyAction } from "../studio/src/pcb/canvas-keys.js"

const SOURCE = `export default () => (
  <board width="20mm" height="20mm">
    <resistor name="R1" resistance="1k" schX={1} schY={2} pcbX="3mm" pcbY={4} />
    <resistor name="R2" resistance="2k" />
    <led name="D1" pinLabels={{ pin1: "anode", pin2: "cathode" }} color={"red".toUpperCase()} />
    <trace from="R1.pin2" to="D1.pin1" schematicRouteHints={[{ x: 1, y: 1 }]} />
    <trace from="R1.pin1" to="net.VCC" />
    <trace from="R2.pin1" to="R1.pin1" />
  </board>
)
`

describe("Edit → Copy", () => {
  test("keeps the parts as written and the traces among them or to a named net, naming expressions it leaves out", () => {
    const clip = copyParts(analyzeCircuit(SOURCE), ["R1", "D1"])
    if ("message" in clip) throw new Error(clip.message)
    expect(clip.parts).toEqual([
      { tag: "resistor", name: "R1", props: { resistance: "1k", schX: 1, schY: 2, pcbX: "3mm", pcbY: 4 } },
      { tag: "led", name: "D1", props: {}, pinLabels: { pin1: "anode", pin2: "cathode" } },
    ])
    expect(clip.traces.map((trace) => `${trace.from}-${trace.to}`)).toEqual(["R1.pin2-D1.pin1", "R1.pin1-net.VCC"])
    expect(clip.left).toEqual(["D1.color"])
    expect(copyParts(analyzeCircuit(SOURCE), [])).toEqual({ message: "Select the parts to copy first." })
  })
})

describe("Edit → Paste", () => {
  test("renumbers each designator to the lowest free number, filling a gap", () => {
    expect([...pasteNames(["R1", "D1", "R2"], ["R1", "R2", "D1"])]).toEqual([["R1", "R3"], ["D1", "D2"], ["R2", "R4"]])
    expect([...pasteNames(["R5"], ["R1", "R3"])]).toEqual([["R5", "R2"]])
  })

  test("designators sub-sheet instances bring in are taken too", () => {
    const model = analyzeCircuit(SOURCE)
    const clip = copyParts(model, ["R2"])
    if ("message" in clip) throw new Error(clip.message)
    expect(pasteEdits(clip, model, { taken: ["R3"] })).toMatchObject({ names: ["R4"] })
  })

  test("lands the copy's middle at the pointer in its view; without one each paste steps one more offset", () => {
    const model = analyzeCircuit(SOURCE)
    const clip = copyParts(model, ["R1"])
    if ("message" in clip) throw new Error(clip.message)
    expect(pasteShift(clip, { view: "sch", at: { x: 5, y: 5 } }, 1)).toEqual({ sch: { x: 4, y: 3 }, pcb: { x: PASTE_OFFSET.pcb, y: -PASTE_OFFSET.pcb } })
    const second = pasteEdits(clip, model, { shift: pasteShift(clip, undefined, 2) })
    if ("message" in second) throw new Error(second.message)
    expect(second.edits[0]).toMatchObject({ props: { schX: 1 + 2 * PASTE_OFFSET.sch, schY: 2 - 2 * PASTE_OFFSET.sch } })
  })

  test("a library part's import comes along into a file in the same folder, and is refused from another folder", () => {
    const lib = `import { LDO } from "./parts/ldo"\n${SOURCE.replace("<resistor name=\"R2\"", "<LDO name=\"U1\" />\n    <resistor name=\"R2\"")}`
    const clip = copyParts(analyzeCircuit(lib), ["U1"], "boards/a.circuit.tsx")
    if ("message" in clip) throw new Error(clip.message)
    const target = analyzeCircuit(SOURCE)
    const pasted = pasteEdits(clip, target, { file: "boards/b.circuit.tsx" })
    if ("message" in pasted) throw new Error(pasted.message)
    expect(pasted.edits[0]).toMatchObject({ kind: "addPart", tag: "LDO", name: "U1", importFrom: "./parts/ldo" })
    expect(applyEdits(SOURCE, pasted.edits, new Set())).toContain('import { LDO } from "./parts/ldo"')
    expect(pasteEdits(clip, target, { file: "other.circuit.tsx" })).toHaveProperty("message")
  })

  test("writes the parts, moved a little, and their traces renamed, as edits the core takes in one change", () => {
    const model = analyzeCircuit(SOURCE)
    const clip = copyParts(model, ["R1", "D1"])
    if ("message" in clip) throw new Error(clip.message)
    const pasted = pasteEdits(clip, model)
    if ("message" in pasted) throw new Error(pasted.message)
    const { edits, summary, names } = pasted
    expect(names).toEqual(["R3", "D2"])
    expect(summary).toBe("paste 2 parts (R3, D2)")
    expect(edits[0]).toEqual({ kind: "addPart", tag: "resistor", name: "R3", props: { resistance: "1k", schX: 1 + PASTE_OFFSET.sch, schY: 2 - PASTE_OFFSET.sch, pcbX: 3 + PASTE_OFFSET.pcb, pcbY: 4 - PASTE_OFFSET.pcb } })
    const next = applyEdits(SOURCE, edits, new Set())
    expect(next).toContain('<led name="D2" pinLabels={{ pin1: "anode", pin2: "cathode" }} />')
    expect(next).toContain('<trace from="R3.pin2" to="D2.pin1" schematicRouteHints={[{ x: 1.5, y: 0.5 }]} />')
    expect(next).toContain('<trace from="R3.pin1" to="net.VCC" />')
    expect(analyzeCircuit(next).parts.map((part) => part.name)).toEqual(["R1", "R2", "D1", "R3", "D2"])
  })

  test("Ctrl+C and Ctrl+V are the copy and paste keys in both views; Ctrl+C leaves the browser's copy alone", () => {
    const key = (k: string) => ({ key: k, shiftKey: false, altKey: false, ctrlKey: true, metaKey: false, typing: false })
    for (const view of ["pcb", "schematic"] as const) {
      expect(keyAction(key("c"), { view })).toEqual({ action: "copy", preventDefault: false })
      expect(keyAction(key("v"), { view })).toEqual({ action: "paste", preventDefault: true })
    }
    expect(keyAction({ ...key("c"), typing: true }, { view: "pcb" })).toBeNull()
  })
})
