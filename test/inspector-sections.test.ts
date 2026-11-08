import { describe, expect, test } from "vitest"
import { inspectorSections, boardSections, type InspectorPart } from "../studio/src/inspector-sections.js"

const prop = (literal: string | number) => ({ literal, source: String(literal), editable: true })

const resistor: InspectorPart = {
  tag: "resistor",
  props: { resistance: prop("10k"), footprint: prop("0402"), pcbX: prop(3), pcbY: prop(4), pcbRotation: prop(90) },
}

describe("inspectorSections", () => {
  test("a part's sections come in the order Basic, Position, Connections, Notes", () => {
    expect(inspectorSections(resistor, { library: false }).map((s) => s.title)).toEqual(["Basic", "Position", "Connections", "Notes"])
  })

  test("a library part gets a Library section between Connections and Notes", () => {
    expect(inspectorSections(resistor, { library: true }).map((s) => s.title)).toEqual(["Basic", "Position", "Connections", "Library", "Notes"])
  })

  test("Basic holds name, kind and the value props; position props move to Position", () => {
    const [basic, position] = inspectorSections(resistor, { library: false })
    expect(basic?.rows).toEqual(["name", "kind", "prop:resistance", "prop:footprint"])
    expect(position?.rows).toEqual(["prop:pcbX", "prop:pcbY", "prop:pcbRotation", "lock"])
  })

  test("usual props the part lacks are offered in Basic, position props never are", () => {
    const bare: InspectorPart = { tag: "resistor", props: { pcbX: prop(1) } }
    const [basic, position] = inspectorSections(bare, { library: false })
    expect(basic?.rows).toEqual(["name", "kind", "suggest:resistance", "suggest:footprint"])
    expect(position?.rows).toEqual(["prop:pcbX", "lock"])
  })

  test("schematic position, side and layer props are positions too", () => {
    const part: InspectorPart = { tag: "diode", props: { layer: prop("bottom"), schY: prop(2), schX: prop(1), side: prop("top") } }
    const [, position] = inspectorSections(part, { library: false })
    expect(position?.rows).toEqual(["prop:schX", "prop:schY", "prop:side", "prop:layer", "lock"])
  })

  test("a part with no props still has Position with the lock row", () => {
    const [basic, position] = inspectorSections({ tag: "net", props: {} }, { library: false })
    expect(basic?.rows).toEqual(["name", "kind"])
    expect(position?.rows).toEqual(["lock"])
  })

  test("Connections, Library and Notes each hold one row", () => {
    const rest = inspectorSections(resistor, { library: true }).slice(2)
    expect(rest.map((s) => s.rows)).toEqual([["connections"], ["library"], ["notes"]])
  })
})

describe("boardSections", () => {
  test("with nothing selected: Build, Notes for the agent", () => {
    expect(boardSections().map((s) => s.title)).toEqual(["Build", "Notes for the agent"])
  })
})
