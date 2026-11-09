import { describe, expect, test } from "vitest"
import { GROUP_ACTIONS, inspectorSections, boardSections, propertiesView, type InspectorPart } from "../studio/src/inspector-sections.js"

const prop = (literal: string | number) => ({ literal, source: String(literal), editable: true })

const resistor: InspectorPart = {
  tag: "resistor",
  props: { resistance: prop("10k"), footprint: prop("0402"), pcbX: prop(3), pcbY: prop(4), pcbRotation: prop(90) },
}

describe("inspectorSections", () => {
  test("a part's sections come in the order Basic, Footprint, Position, Connections, Notes", () => {
    expect(inspectorSections(resistor, { library: false }).map((s) => s.title)).toEqual(["Basic", "Footprint", "Position", "Connections", "Notes"])
  })

  test("a library part gets a Library section between Connections and Notes", () => {
    expect(inspectorSections(resistor, { library: true }).map((s) => s.title)).toEqual(["Basic", "Footprint", "Position", "Connections", "Library", "Notes"])
  })

  test("Basic holds name, kind and the value props; the footprint has its own section; position props move to Position", () => {
    const [basic, footprint, position] = inspectorSections(resistor, { library: false })
    expect(basic?.rows).toEqual(["name", "kind", "prop:resistance"])
    expect(footprint?.rows).toEqual(["prop:footprint"])
    expect(position?.rows).toEqual(["prop:pcbX", "prop:pcbY", "prop:pcbRotation", "lock"])
  })

  test("usual props the part lacks are offered, the footprint in Footprint, position props never", () => {
    const bare: InspectorPart = { tag: "resistor", props: { pcbX: prop(1) } }
    const [basic, footprint, position] = inspectorSections(bare, { library: false })
    expect(basic?.rows).toEqual(["name", "kind", "suggest:resistance"])
    expect(footprint).toEqual({ title: "Footprint", rows: ["suggest:footprint"] })
    expect(position?.rows).toEqual(["prop:pcbX", "lock"])
  })

  test("a part with no footprint and none to offer has no Footprint section", () => {
    const header: InspectorPart = { tag: "pinheader", props: { pinCount: prop(4) } }
    expect(inspectorSections(header, { library: false }).map((s) => s.title)).toEqual(["Basic", "Position", "Connections", "Notes"])
  })

  test("schematic position, side and layer props are positions too", () => {
    const part: InspectorPart = { tag: "diode", props: { layer: prop("bottom"), schY: prop(2), schX: prop(1), side: prop("top") } }
    const position = inspectorSections(part, { library: false }).find((s) => s.title === "Position")
    expect(position?.rows).toEqual(["prop:schX", "prop:schY", "prop:side", "prop:layer", "lock"])
  })

  test("a part with no props still has Position with the lock row", () => {
    const [basic, position] = inspectorSections({ tag: "net", props: {} }, { library: false })
    expect(basic?.rows).toEqual(["name", "kind"])
    expect(position?.rows).toEqual(["lock"])
  })

  test("Connections, Library and Notes each hold one row", () => {
    const rest = inspectorSections(resistor, { library: true }).slice(3)
    expect(rest.map((s) => s.rows)).toEqual([["connections"], ["library"], ["notes"]])
  })
})

describe("boardSections", () => {
  test("with nothing selected: Build, Notes for the agent", () => {
    expect(boardSections().map((s) => s.title)).toEqual(["Build", "Notes for the agent"])
  })
})

describe("propertiesView", () => {
  const named = (name: string, part: InspectorPart = resistor) => ({ ...part, name })

  test("with nothing selected: the board's sections under Selected objects: 0", () => {
    expect(propertiesView([], { library: false })).toEqual({ header: "Selected objects: 0", sections: boardSections() })
  })

  test("with one part: that part's sections under Selected objects: 1", () => {
    expect(propertiesView([named("R1")], { library: true })).toEqual({ header: "Selected objects: 1", sections: inspectorSections(resistor, { library: true }) })
  })

  test("with three parts: one Selection section listing them in the order they were picked", () => {
    const view = propertiesView([named("R2"), named("C1", { tag: "capacitor", props: {} }), named("R1")], { library: false })
    expect(view).toEqual({ header: "Selected objects: 3", sections: [{ title: "Selection", rows: ["part:R2", "part:C1", "part:R1"] }] })
  })

  test("several parts get Rotate, Lock, Unlock and Delete, each run as the menu's command", () => {
    expect(GROUP_ACTIONS.map((action) => [action.label, action.command])).toEqual([
      ["Rotate", "rotate"],
      ["Lock", "lock"],
      ["Unlock", "unlock"],
      ["Delete", "delete"],
    ])
  })
})
