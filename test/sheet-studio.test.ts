import { describe, expect, test } from "vitest"
import { serializeLayout, type TrackRecord } from "../src/core/layout-file.js"
import { buildDesign } from "../src/engine/design.js"
import { connectionsWith, instancePart, instancePartBlocker, instanceSelection, lockedWithInstances, partsOfInstance, sheetUses, topInstance, usedLine } from "../studio/src/pcb/instances.js"
import { replicatePlan } from "../studio/src/pcb/replicate.js"
import { dropCorner, dropPin, handleAt, symbolHandles } from "../studio/src/pcb/sheet-symbol-edit.js"
import { endAt, portWire, wireEdits, type WireEnd } from "../studio/src/pcb/wire-tool.js"
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

  test("refuses instances without a written place, and instances the copy would overlap", () => {
    const files = (body: string) => buildDesign({ [MAIN]: main(body), [SHEET]: POWER }, MAIN)
    const unplaced = files([`<PowerStage name="PS1" connections={{ VIN: "A", VOUT: "B", GND: "GND" }} pcbX={-10} pcbY={0} />`, `<PowerStage name="PS2" connections={{ VIN: "C", VOUT: "D", GND: "GND" }} />`].join(" "))
    expect(replicatePlan(unplaced, ["PS1"])).toEqual({ message: "Place PS2 on the board first (pcbX and pcbY on the instance), then replicate the layout." })
    const close = files([`<PowerStage name="PS1" connections={{ VIN: "A", VOUT: "B", GND: "GND" }} pcbX={-10} pcbY={0} />`, `<PowerStage name="PS2" connections={{ VIN: "C", VOUT: "D", GND: "GND" }} pcbX={-9.5} pcbY={0} />`].join(" "))
    expect(replicatePlan(close, ["PS1"])).toEqual({ message: "PS1 and PS2 would overlap; place the instances apart first, then replicate the layout." })
    expect(replicatePlan(design(), ["PS1"], (name) => name !== "PS1")).toEqual({ message: "Place PS1 on the board first (pcbX and pcbY on the instance), then replicate the layout." })
  })

  test("refuses when a target instance is locked, naming it, since the sheet's placement would move its parts", () => {
    expect(replicatePlan(design(), ["PS1"], undefined, new Set(["PS2"]))).toEqual({ message: "PS2 is locked; unlock it to replicate the layout of PS1 to it." })
    expect("message" in replicatePlan(design(), ["PS1"], undefined, new Set(["PS1"]))).toBe(false)
  })

  test("removes only the target's own copper, not a parent net's track passing over it", () => {
    const passing: TrackRecord = { t: "track", id: "t0001", net: "net.VBUS", layer: "bottom", width: 0.2, points: [{ x: 9.8, y: 4 }, { x: 10.2, y: 6 }], locked: false, by: "human" }
    const own: TrackRecord = { t: "track", id: "t0002", net: "net.PS2/MID", layer: "top", width: 0.2, points: [{ x: 10, y: 5 }, { x: 10, y: 6 }], locked: false, by: "human" }
    const plan = replicatePlan(design(serializeLayout({ next: { track: 3, via: 1 }, records: [passing, own] })), ["PS1"])
    if ("message" in plan) throw new Error(plan.message)
    expect(plan.layout.edits.filter((edit) => edit.kind === "removeTrack")).toEqual([{ kind: "removeTrack", id: "t0002" }])
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

describe("wiring a sheet symbol's pin", () => {
  const BUS_SHEET = POWER.replace(`<port name="GND" />`, `<port name="GND" />\n      <port name="D[0:3]" bus />`)
  const built = buildDesign({ [MAIN]: main([TWO, `<resistor name="R9" footprint="0402" schX={0} schY={3} />`, `<trace from="R9.pin1" to="net.SIG" />`].join("\n")), [SHEET]: BUS_SHEET }, MAIN)
  const pinOf = (pin: string) => {
    const at = built.schematic.symbols.find((s) => s.component === "PS1")?.pinEnds[pin]
    if (!at) throw new Error(`no ${pin}`)
    return endAt(built, at, 0.01) as WireEnd
  }

  test("to a pin on a named net writes the instance's connections, never a trace", () => {
    const r9 = built.schematic.symbols.find((s) => s.component === "R9")?.pinEnds["R9.pin1"]
    if (!r9) throw new Error("no R9")
    const vin = pinOf("PS1.VIN")
    expect(vin.port).toEqual({ instance: "PS1", name: "VIN", bus: false })
    expect(portWire(built, vin, endAt(built, r9, 0.01) as WireEnd)).toEqual({
      edits: [{ kind: "setConnections", part: "PS1", connections: { VIN: "SIG", VOUT: "V3_3", GND: "GND" } }],
      summary: "connect PS1.VIN to SIG",
    })
  })

  test("a bus pin takes a bus with the same members, and nothing else", () => {
    const bus: WireEnd = { selector: "bus:D[0:3]", at: { x: 0, y: 0 }, label: "D[0:3]", members: ["D0", "D1", "D2", "D3"] }
    const data = pinOf("PS1.D[0:3]")
    expect(portWire(built, bus, data)).toMatchObject({ edits: [{ kind: "setConnections", part: "PS1", connections: { "D[0:3]": "D[0:3]" } }] })
    expect(portWire(built, data, { ...bus, label: "A[0:1]", members: ["A0", "A1"] })).toEqual({ notice: "PS1.D[0:3] is a bus pin; wire it to a bus with the members D0, D1, D2, D3" })
  })

  test("to an end with no named net is refused with what to do", () => {
    const loose: WireEnd = { selector: "R1.pin1", at: { x: 0, y: 0 }, label: "R1.pin1", pin: "R1.pin1" }
    expect(portWire(built, pinOf("PS1.VOUT"), loose)).toEqual({ notice: "Give the net a name first (a net label), then wire PS1.VOUT to it" })
    expect(wireEdits(built, pinOf("PS1.VOUT"), loose, [])).toEqual([])
  })
})
