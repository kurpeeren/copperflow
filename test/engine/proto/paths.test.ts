import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../../../src/engine/design.js"

const MAIN = "main.circuit.tsx"
const LAYOUT = "main.circuit.layout.json"

// On a 10 x 6 board J1's pins are in C2, C3, C4 and J2's in E2, E3, E4; A joins the first pins, B the third.
const PARTS = [
  '<pinheader name="J1" pinCount={3} pitch="2.54mm" pcbX={-6.35} pcbY={1.27} />',
  '<pinheader name="J2" pinCount={3} pitch="2.54mm" pcbX={-6.35} pcbY={-3.81} />',
  '<trace from="J1.pin1" to="net.A" />',
  '<trace from="J2.pin1" to="net.A" />',
  '<trace from="J1.pin3" to="net.B" />',
  '<trace from="J2.pin3" to="net.B" />',
]

function design(kind: "perfboard" | "stripboard", records: readonly object[], extra: readonly string[] = [], parts = PARTS): Design {
  const circuit = `export default () => (\n  <board kind="${kind}" columns={10} rows={6}>\n${[...parts, ...extra].join("\n")}\n  </board>\n)\n`
  const layout = records.map((record) => JSON.stringify(record)).join("\n")
  return buildDesign({ [MAIN]: circuit, [LAYOUT]: layout }, MAIN)
}

const found = (built: Design, code: string) => built.violations.filter((v) => v.code === code)
const protoCodes = (built: Design) => [...new Set(built.violations.filter((v) => v.code.startsWith("proto-")).map((v) => v.code))].sort()
const solder = (id: string, holes: string[], net?: string) => ({ t: "solder", id, holes, ...(net ? { net } : {}) })
const link = (id: string, from: string, to: string, net?: string) => ({ t: "link", id, from, to, ...(net ? { net } : {}) })
const cut = (id: string, where: string | [string, string]) => ({ t: "cut", id, ...(typeof where === "string" ? { at: where } : { between: where }) })

describe("perfboard", () => {
  test("with no paths every net is open and has an airwire", () => {
    const built = design("perfboard", [])
    expect(found(built, "proto-open").map((v) => v.message)).toEqual([
      "net A is in 2 pieces not joined yet: J1.pin1 | J2.pin1; run autoroute or add solder or a link",
      "net B is in 2 pieces not joined yet: J1.pin3 | J2.pin3; run autoroute or add solder or a link",
    ])
    expect(built.pcb.ratsnest).toHaveLength(2)
  })

  test("a solder run joins its holes, and the airwire goes", () => {
    const built = design("perfboard", [solder("s1", ["C2", "D2", "E2"], "A")])
    expect(found(built, "proto-open").map((v) => v.items)).toEqual([["net.B"]])
    expect(built.pcb.ratsnest.map((line) => line.net)).toEqual(["net.B"])
    expect(built.pcb.proto).toHaveLength(1)
  })

  test("a link joins its ends", () => {
    const built = design("perfboard", [solder("s1", ["C2", "D2", "E2"]), link("w1", "C4", "E4")])
    expect(protoCodes(built)).toEqual([])
    expect(built.pcb.ratsnest).toEqual([])
  })

  test("solder across two nets is a short", () => {
    const built = design("perfboard", [solder("s1", ["C2", "C3", "C4"])])
    expect(found(built, "proto-short")[0]?.message).toBe("A and B are joined: J1.pin1 (C2) and J1.pin3 (C4) are on one piece of copper; remove the solder or link that joins them")
  })

  test("a solder step that is not to a neighbour joins nothing and is named", () => {
    const built = design("perfboard", [solder("s1", ["C2", "E2"])])
    expect(found(built, "proto-solder")[0]?.message).toBe("solder s1 C2–E2 steps from C2 to E2, which are not neighbours; solder joins one hole to the next")
    expect(found(built, "proto-open")).toHaveLength(2)
  })

  test("a solder hole outside the board is named", () => {
    const built = design("perfboard", [solder("s1", ["C2", "C11"])])
    expect(found(built, "proto-solder")[0]?.message).toBe("solder s1 C2–C11: C11 is outside the board's holes")
  })

  test("a link must be straight, stay off the legs and not cross another link", () => {
    const built = design("perfboard", [link("w1", "C2", "E3"), link("w2", "C1", "C5"), link("w3", "A7", "D7"), link("w4", "B5", "B9"), link("w5", "A1", "A11")])
    expect(found(built, "proto-link").map((v) => v.message)).toEqual([
      "link w1 C2–E3 is not straight: a link runs along one row or one column",
      "link w2 C1–C5 runs over the leg of J1.pin1 at C2",
      "link w4 B5–B9 crosses link w3 at B7; links on the top side do not cross",
      "link w5 A1–A11 ends outside the board's holes",
    ])
  })

  test("a cut on perfboard is out of place", () => {
    expect(found(design("perfboard", [cut("x1", "A1")]), "proto-record")[0]?.message).toBe("cut x1 at A1: a perfboard has no strips to cut")
  })

  test("a record's net must be the net of the pins it joins", () => {
    const built = design("perfboard", [solder("s1", ["C2", "D2", "E2"], "B"), link("w1", "C4", "E4", "net.B")])
    expect(found(built, "proto-record").map((v) => v.message)).toEqual(["solder s1 C2–E2 says net B but joins pins of A"])
  })
})

describe("stripboard", () => {
  test("a strip joins every pin along it", () => {
    const built = design("stripboard", [])
    expect(found(built, "proto-short").map((v) => v.message)).toEqual([
      "A and B are joined: J1.pin1 (C2) and J1.pin3 (C4) are on one piece of copper; strip C joins them: cut it between the two",
      "A and B are joined: J2.pin1 (E2) and J2.pin3 (E4) are on one piece of copper; strip E joins them: cut it between the two",
    ])
  })

  test("cuts and links make it right", () => {
    const records = [cut("x1", ["C2", "C3"]), cut("x2", ["C3", "C4"]), cut("x3", ["E2", "E3"]), cut("x4", ["E3", "E4"]), link("w1", "C1", "E1"), link("w2", "C5", "E5")]
    const built = design("stripboard", records)
    expect(protoCodes(built)).toEqual([])
    expect(built.pcb.ratsnest).toEqual([])
  })

  test("a cut drilled at a hole parts the strip there", () => {
    const records = [cut("x1", "C1"), cut("x2", ["C2", "C3"]), cut("x3", ["C3", "C4"]), cut("x4", ["E2", "E3"]), cut("x5", ["E3", "E4"]), link("w1", "C1", "E1")]
    const built = design("stripboard", records)
    // The link's top end is in the drilled hole, which no longer touches strip C: A stays open.
    expect(found(built, "proto-open").map((v) => v.items)).toEqual([["net.A"], ["net.B"]])
  })

  test("a cut in a pin's hole is refused", () => {
    expect(found(design("stripboard", [cut("x1", "C3")]), "proto-cut")[0]?.message).toBe("cut x1 at C3 is in the hole of J1.pin2; cut beside it instead")
  })

  test("a cut between holes that are not neighbours on a strip is refused", () => {
    expect(found(design("stripboard", [cut("x1", ["C6", "D6"])]), "proto-cut")[0]?.message).toBe("cut x1 between C6 and D6: the two holes must be neighbours on one strip")
  })

  test("a cut that parts a net with nothing else joining it", () => {
    const parts = ['<pinheader name="J1" pinCount={2} pitch="2.54mm" pcbX={-7.62} pcbY={1.27} />', '<trace from="J1.pin1" to="net.N" />', '<trace from="J1.pin2" to="net.N" />']
    const built = design("stripboard", [cut("x1", ["C2", "C3"])], [], parts)
    expect(found(built, "proto-cut-splits")[0]?.message).toBe("cut x1 between C2 and C3 parts net N (J1.pin1 from J1.pin2) and nothing else joins them; remove the cut or join the two sides")
    const joined = design("stripboard", [cut("x1", ["C2", "C3"]), link("w1", "C1", "E1"), link("w2", "C4", "E4")], [], parts)
    expect(found(joined, "proto-cut-splits")).toEqual([])
  })

  test("strips can run down the columns", () => {
    const circuit = `export default () => (\n  <board kind="stripboard" columns={10} rows={6} strips="columns">\n${PARTS.join("\n")}\n  </board>\n)\n`
    const built = buildDesign({ [MAIN]: circuit }, MAIN)
    // Down the columns, J1.pin1 (C2) and J2.pin1 (E2) share strip 2: A is joined, B too, and nothing is shorted.
    expect(protoCodes(built)).toEqual([])
  })

  test("a cut outside the holes is named", () => {
    expect(found(design("stripboard", [cut("x1", "Z1")]), "proto-record")[0]?.message).toBe("cut x1 at Z1 is outside the board's holes")
  })
})
