import { describe, expect, test } from "vitest"
import { serializeLayout, type TrackRecord } from "../src/core/layout-file.js"
import { buildDesign } from "../src/engine/design.js"
import { connectionsWith, instancePart, instancePartBlocker, instanceSelection, lockedWithInstances, partsOfInstance, sheetUses, topInstance, usedLine } from "../studio/src/pcb/instances.js"
import { replicatePlan } from "../studio/src/pcb/replicate.js"
import { dropCorner, dropPin, handleAt, symbolHandles } from "../studio/src/pcb/sheet-symbol-edit.js"
import { docTabs, tabTarget } from "../studio/src/shell/doc-tabs.js"
import { buildPageTree } from "../studio/src/shell/page-tree.js"

const MAIN = "main.circuit.tsx"
const SHEET = "PowerStage.sheet.tsx"

const POWER = `export default function PowerStage() {
  return (
    <sheet>
      <port name="VIN" />
      <port name="VOUT" />
      <port name="GND" />
      <resistor name="R1" footprint="0402" pcbX={0} pcbY={0} />
      <resistor name="R2" footprint="0402" />
      <trace from="R1.pin1" to="net.VIN" />
      <trace from="R1.pin2" to="net.MID" />
      <trace from="R2.pin1" to="net.MID" />
      <trace from="R2.pin2" to="net.VOUT" />
    </sheet>
  )
}
`

const main = (body: string) => `import PowerStage from "./PowerStage.sheet"
export default () => (
  <board width="40mm" height="40mm">
${body}
  </board>
)
`

const TWO = [
  `<PowerStage name="PS1" connections={{ VIN: "VBUS", VOUT: "V3_3", GND: "GND" }} schX={2} schY={0} pcbX={-10} pcbY={0} />`,
  `<PowerStage name="PS2" connections={{ VIN: "V3_3", VOUT: "V1_8", GND: "GND" }} schX={6} schY={0} pcbX={10} pcbY={5} pcbRotation={90} />`,
  `<resistor name="R1" footprint="0402" pcbX={0} pcbY={-10} />`,
].join("\n")

function design(layout?: string) {
  const files: Record<string, string> = { [MAIN]: main(TWO), [SHEET]: POWER }
  if (layout !== undefined) files["main.circuit.layout.json"] = layout
  return buildDesign(files, MAIN)
}

describe("instances in the Studio", () => {
  const built = design()

  test("a flattened part names its instance, its local name and its sheet", () => {
    expect(instancePart(built, "R201")).toEqual({ part: "R201", localId: "R1", instance: "PS2", outer: "PS2", sheet: "PowerStage", file: SHEET })
    expect(instancePart(built, "R1")).toBeUndefined()
    expect(topInstance(built, "PS1")?.file).toBe(SHEET)
    expect(partsOfInstance(built, "PS1")).toEqual(["R101", "R102"])
    expect(sheetUses(built, SHEET)).toBe(2)
    expect(usedLine("PowerStage", 2)).toBe("In PowerStage, used 2 times")
    expect(usedLine("PowerStage", 1)).toBe("In PowerStage, used once")
  })

  test("Select the instance takes every part of the instance a selected part or symbol is in", () => {
    expect(instanceSelection(built, ["R102"])).toEqual(["R101", "R102"])
    expect(instanceSelection(built, ["PS2", "R101"])).toEqual(["R201", "R202", "R101", "R102"])
    expect(instanceSelection(built, ["R1"])).toBeUndefined()
  })

  test("a locked instance locks its parts, and a part an instance made is placed in its sheet", () => {
    expect([...lockedWithInstances(new Set(["PS1"]), built)].sort()).toEqual(["PS1", "R101", "R102"])
    expect(instancePartBlocker(built, new Set(["PS1"]), "R101")).toBe("R101 is in PS1, which is locked")
    expect(instancePartBlocker(built, new Set(), "R201")).toMatch(/^R201 is R1 of PS2; it is placed in PowerStage\.sheet\.tsx/)
    expect(instancePartBlocker(built, new Set(), "R1")).toBeUndefined()
  })

  test("a connection changed in Properties keeps the others, and an empty one is left out", () => {
    const ps1 = topInstance(built, "PS1")
    if (!ps1) throw new Error("no PS1")
    expect(connectionsWith(ps1, "VIN", "V5")).toEqual({ VIN: "V5", VOUT: "V3_3", GND: "GND" })
    expect(connectionsWith(ps1, "VOUT", "")).toEqual({ VIN: "VBUS", GND: "GND" })
  })
})

describe("editing the sheet symbol on the parent page", () => {
  const built = design()

  test("a selected symbol has a handle where each pin meets the box, and one at its lower right corner", () => {
    const handles = symbolHandles(built, ["PS1"])
    expect(handles.map((h) => (h.kind === "pin" ? `${h.port} ${h.at.x},${h.at.y}` : `corner ${h.at.x},${h.at.y}`))).toEqual(["VIN 2,-0.2", "VOUT 3.2,-0.2", "GND 2.2,-0.6", "corner 3.2,-0.6"])
    expect(symbolHandles(built, ["R1"])).toEqual([])
    expect(handleAt(handles, { x: 3.21, y: -0.6 }, 0.05)).toMatchObject({ kind: "corner", instance: "PS1" })
    expect(handleAt(handles, { x: 5, y: 5 }, 0.05)).toBeUndefined()
  })

  test("a pin dropped on another side writes its side and order in the sheet file, as one request", () => {
    const vin = symbolHandles(built, ["PS1"])[0]
    if (vin?.kind !== "pin") throw new Error("no pin")
    expect(dropPin(built, vin, { x: 2.6, y: 0.05 })).toEqual({
      file: SHEET,
      edits: [{ kind: "setProps", part: "VIN", props: { side: "top", order: 3 } }],
      summary: "Move port VIN of PowerStage to top 3",
    })
    expect(dropPin(built, vin, { x: 1.95, y: -0.21 })).toEqual({ message: "VIN stays where it is" })
  })

  test("a pin dropped on a taken place swaps with the port there", () => {
    const vin = symbolHandles(built, ["PS1"])[0]
    if (vin?.kind !== "pin") throw new Error("no pin")
    const change = dropPin(built, vin, { x: 3.25, y: -0.2 })
    expect(change).toMatchObject({
      edits: [
        { kind: "setProps", part: "VIN", props: { side: "right", order: 1 } },
        { kind: "setProps", part: "VOUT", props: { side: "left", order: 1 } },
      ],
    })
  })

  test("the corner dropped sizes the box, never below what its ports need", () => {
    const corner = symbolHandles(built, ["PS1"]).find((h) => h.kind === "corner")
    if (corner?.kind !== "corner") throw new Error("no corner")
    expect(dropCorner(built, corner, { x: 4.95, y: -1.3 })).toEqual({ file: SHEET, edits: [{ kind: "setSheetSize", width: 3, height: 1.4 }], summary: "Size the PowerStage symbol to 3 × 1.4" })
    expect(dropCorner(built, corner, { x: 2.1, y: -0.1 })).toEqual({ message: "PowerStage keeps its size" })
  })
})

describe("Replicate layout", () => {
  test("writes the source's auto-placed parts into the sheet and copies its copper into each other instance's frame", () => {
    const first = design()
    const r101 = first.pcb.parts.find((p) => p.component === "R101")
    const r102 = first.pcb.parts.find((p) => p.component === "R102")
    if (!r101 || !r102) throw new Error("not placed")
    const track: TrackRecord = { t: "track", id: "t0001", net: "net.PS1/MID", layer: "top", width: 0.2, points: [{ x: -10, y: 0 }, { x: -9, y: 0 }], locked: false, by: "human" }
    const built = design(serializeLayout({ next: { track: 2, via: 1 }, records: [track] }))
    const plan = replicatePlan(built, ["R101"])
    if ("message" in plan) throw new Error(plan.message)
    expect(plan.source).toBe("PS1")
    expect(plan.targets).toEqual(["PS2"])
    // R1 writes its place in the sheet; R2 is auto-placed, so its place in PS1 is written, relative to PS1.
    expect(plan.sheet).toEqual({
      file: SHEET,
      edits: [{ kind: "setProps", part: "R2", props: { pcbX: r102.x + 10, pcbY: r102.y } }],
      summary: "Replicate the placement of PS1 in PowerStage",
    })
    // PS2 sits at (10, 5) turned 90°: (-10, 0)→(10, 5) and (-9, 0)→(10, 6); its MID is its own.
    expect(plan.layout.edits).toEqual([{ kind: "addTrack", net: "net.PS2/MID", layer: "top", width: 0.2, points: [{ x: 10, y: 5 }, { x: 10, y: 6 }] }])
    expect(plan.layout.summary).toBe("Replicate the copper of PS1 to PS2")
  })

  test("says why when there is nothing to copy to", () => {
    expect(replicatePlan(design(), ["R1"])).toEqual({ message: "Select a part of the instance whose layout to copy, or its symbol on the schematic." })
    const one = buildDesign({ [MAIN]: main(`<PowerStage name="PS1" connections={{ VIN: "A", VOUT: "B", GND: "GND" }} />`), [SHEET]: POWER }, MAIN)
    expect(replicatePlan(one, ["PS1"])).toEqual({ message: "PS1 is the only instance of PowerStage; there is nothing to copy its layout to." })
  })
})

describe("a sheet file in the tabs and the tree", () => {
  test("opens as its own Schematic tab, after the tabs of the circuit it came from", () => {
    const tabs = docTabs(SHEET, "schematic", ["Main"], "Main", MAIN)
    expect(tabs.map((t) => [t.id, t.title, t.active])).toEqual([
      ["parent:schematic", "main Schematic", false],
      ["parent:pcb", "main PCB", false],
      ["schematic", "PowerStage (sheet)", true],
    ])
    expect(tabTarget("parent:pcb")).toEqual({ view: "pcb", parent: true })
    expect(docTabs(SHEET, "schematic").map((t) => t.title)).toEqual(["PowerStage (sheet)"])
  })

  test("the tree lists a sheet file with its one Schematic", () => {
    const tree = buildPageTree("demo", [MAIN, SHEET], SHEET, "schematic")
    expect(tree.files.map((f) => [f.file, f.documents.map((d) => `${d.label}${d.active ? "*" : ""}`)])).toEqual([
      [MAIN, ["Schematic", "PCB"]],
      [SHEET, ["Schematic*"]],
    ])
  })
})
