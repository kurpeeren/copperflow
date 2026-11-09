import { describe, expect, test } from "vitest"
import { copperFieldEdit, copperProperties, type CopperDesign } from "../studio/src/pcb/copper-props.js"

const design: CopperDesign = {
  circuit: { nets: [{ id: "net.GND", names: ["GND"] }] },
  pcb: {
    tracks: [
      { id: "t0001", net: "net.GND", layer: "top", width: 0.25, points: [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }], locked: false, by: "human", pads: [] },
      { id: "t0002", layer: "bottom", width: 0.3, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], locked: true, by: "agent", pads: [] },
    ],
    vias: [{ id: "v0001", net: "net.GND", at: { x: 3, y: 10 }, drill: 0.3, diameter: 0.6, layers: ["top", "bottom"], locked: false, by: "human" }],
  },
}

describe("copperProperties", () => {
  test("a track: net, layer, width, length and lock, the editable ones marked", () => {
    expect(copperProperties(design, "t0001")).toEqual({
      kind: "track",
      title: "Track",
      locked: false,
      rows: [
        { label: "Net", value: "GND" },
        { label: "Layer", value: "top", field: "layer" },
        { label: "Width", value: "0.25", field: "width" },
        { label: "Length", value: "11 mm" },
        { label: "Drawn by", value: "You" },
        { label: "Locked", value: "false", field: "lock" },
      ],
    })
  })

  test("a via: net, layers, drill and diameter, and lock", () => {
    expect(copperProperties(design, "v0001")?.rows).toEqual([
      { label: "Net", value: "GND" },
      { label: "Layers", value: "Top Layer to Bottom Layer" },
      { label: "Drill", value: "0.3 mm" },
      { label: "Diameter", value: "0.6 mm" },
      { label: "Drawn by", value: "You" },
      { label: "Locked", value: "false", field: "lock" },
    ])
  })

  test("copper on no net says so; the agent's copper says who drew it; an unknown id has nothing", () => {
    const rows = copperProperties(design, "t0002")?.rows ?? []
    expect(rows[0]).toEqual({ label: "Net", value: "No net" })
    expect(rows.find((row) => row.label === "Drawn by")?.value).toBe("The agent")
    expect(copperProperties(design, "t0099")).toBeUndefined()
  })
})

describe("copperFieldEdit", () => {
  const [track, locked] = design.pcb.tracks
  const via = design.pcb.vias[0]
  if (!track || !locked || !via) throw new Error("fixture")

  test("width takes a number above 0 in mm", () => {
    expect(copperFieldEdit(track, "width", "0.4")).toEqual({ edit: { kind: "setTrack", id: "t0001", width: 0.4 }, summary: "Set the width of t0001 to 0.4 mm" })
    expect(copperFieldEdit(track, "width", "0")).toEqual({ message: "The width must be a number of mm above 0" })
    expect(copperFieldEdit(track, "width", "wide")).toEqual({ message: "The width must be a number of mm above 0" })
  })

  test("layer moves the track to the top or bottom copper", () => {
    expect(copperFieldEdit(track, "layer", "bottom")).toEqual({ edit: { kind: "setTrack", id: "t0001", layer: "bottom" }, summary: "Move t0001 to the bottom layer" })
    expect(copperFieldEdit(track, "layer", "middle")).toEqual({ message: "The layer must be top or bottom" })
  })

  test("lock locks or unlocks a track or a via; a locked track changes nothing else", () => {
    expect(copperFieldEdit(via, "lock", "true")).toEqual({ edit: { kind: "setVia", id: "v0001", locked: true }, summary: "Lock v0001" })
    expect(copperFieldEdit(locked, "lock", "false")).toEqual({ edit: { kind: "setTrack", id: "t0002", locked: false }, summary: "Unlock t0002" })
    expect(copperFieldEdit(locked, "width", "0.5")).toEqual({ message: "t0002 is locked" })
  })

  test("the same value is no change", () => {
    expect(copperFieldEdit(track, "width", "0.25")).toBeUndefined()
    expect(copperFieldEdit(track, "layer", "top")).toBeUndefined()
  })
})
