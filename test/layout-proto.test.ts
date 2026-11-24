import { describe, expect, test } from "vitest"
import { parseLayout, serializeLayout } from "../src/core/layout-file.js"
import { checkProto, nextProtoId, protoWords, serializeProto, type ProtoRecord } from "../src/core/layout-proto.js"

const problems = (raw: Record<string, unknown>) => {
  const result = checkProto(raw)
  return "problems" in result ? result.problems : []
}

describe("solder, link and cut lines", () => {
  test("are read with their defaults", () => {
    expect(checkProto({ t: "solder", id: "s1", holes: ["C3", "C4"] })).toEqual({ record: { t: "solder", id: "s1", locked: false, by: "human", holes: ["C3", "C4"] } })
    expect(checkProto({ t: "link", id: "w2", net: "GND", from: "C3", to: "C9", by: "router" })).toEqual({ record: { t: "link", id: "w2", locked: false, by: "router", net: "GND", from: "C3", to: "C9" } })
    expect(checkProto({ t: "cut", id: "x1", at: "C7" })).toEqual({ record: { t: "cut", id: "x1", locked: false, by: "human", at: "C7" } })
    expect(checkProto({ t: "cut", id: "x2", between: ["C7", "C8"], locked: true })).toEqual({ record: { t: "cut", id: "x2", locked: true, by: "human", between: ["C7", "C8"] } })
  })

  test("refuse a wrong id, kind or field", () => {
    expect(problems({ t: "solder", id: "w1", holes: ["C3", "C4"] })).toEqual(["id must look like s1"])
    expect(problems({ t: "wire", id: "w1" })).toEqual(['t must be "solder", "link" or "cut"'])
    expect(problems({ t: "link", id: "w1", from: "C3", to: "C9", colour: "red" })).toEqual(["unknown field colour"])
    expect(problems({ t: "link", id: "w1", from: "C3", to: "C9", net: "" })).toEqual(["net must be a non-empty string when given"])
    expect(problems({ t: "link", id: "w1", from: "C3", to: "C9", locked: "yes", by: "robot" })).toEqual(["locked must be true or false", "by must be one of human, agent, router"])
  })

  test("refuse holes that are not hole names", () => {
    expect(problems({ t: "solder", id: "s1", holes: ["C3"] })).toEqual(["holes must list 2 to 400 holes"])
    expect(problems({ t: "solder", id: "s1", holes: ["C3", "c4"] })).toEqual(["holes[1] must be a hole name such as C7"])
    expect(problems({ t: "link", id: "w1", from: "3C", to: "C0" })).toEqual(["from must be a hole name such as C7", "to must be a hole name such as C7"])
    expect(problems({ t: "link", id: "w1", from: "C3", to: "C3" })).toEqual(["a link joins two different holes"])
    expect(problems({ t: "cut", id: "x1" })).toEqual(["a cut has at (a hole) or between (two holes), one of them"])
    expect(problems({ t: "cut", id: "x1", at: "C7", between: ["C7", "C8"] })).toEqual(["a cut has at (a hole) or between (two holes), one of them"])
    expect(problems({ t: "cut", id: "x1", at: 7 })).toEqual(["at must be a hole name such as C7"])
    expect(problems({ t: "cut", id: "x1", between: ["C7", "C7"] })).toEqual(['between must be two different hole names, such as ["C7", "C8"]'])
  })

  test("are written in a fixed field order and read back the same", () => {
    const records: ProtoRecord[] = [
      { t: "solder", id: "s1", net: "GND", holes: ["C3", "C4", "D4"], locked: false, by: "router" },
      { t: "link", id: "w1", from: "A1", to: "A5", locked: true, by: "human" },
      { t: "cut", id: "x1", between: ["B2", "B3"], locked: false, by: "router" },
    ]
    const text = serializeProto(records)
    expect(text.split("\n")[0]).toBe('{"t":"solder","id":"s1","net":"GND","holes":["C3","C4","D4"],"locked":false,"by":"router"}')
    const doc = parseLayout(text)
    expect(doc.errors).toEqual([])
    expect(doc.proto).toEqual(records)
    expect(serializeLayout(doc)).toBe(text)
  })

  test("share the file with tracks and reference images, and a bad line is named", () => {
    const text = [
      '{"t":"track","id":"t0001","layer":"top","width":0.25,"points":[{"x":0,"y":0},{"x":1,"y":0}],"locked":false,"by":"human"}',
      '{"t":"link","id":"w1","from":"A1","to":"A5","locked":false,"by":"human"}',
      '{"t":"cut","id":"x1"}',
      '{"t":"link","id":"w1","from":"B1","to":"B5"}',
    ].join("\n")
    const doc = parseLayout(text)
    expect(doc.records).toHaveLength(1)
    expect(doc.proto?.map((r) => r.id)).toEqual(["w1"])
    expect(doc.errors).toEqual(["line 3 (x1): a cut has at (a hole) or between (two holes), one of them", "line 4: w1 is used twice"])
  })

  test("the next id is one past the highest of its kind", () => {
    const records: ProtoRecord[] = [
      { t: "link", id: "w3", from: "A1", to: "A5", locked: false, by: "human" },
      { t: "cut", id: "x1", at: "B2", locked: false, by: "router" },
    ]
    expect(nextProtoId(records, "link")).toBe("w4")
    expect(nextProtoId(records, "cut")).toBe("x2")
    expect(nextProtoId(records, "solder")).toBe("s1")
  })

  test("words for each kind", () => {
    expect(protoWords({ t: "solder", id: "s1", holes: ["C3", "C4", "D4"], locked: false, by: "router" })).toBe("solder s1 C3–D4")
    expect(protoWords({ t: "link", id: "w1", from: "A1", to: "A5", locked: false, by: "router" })).toBe("link w1 A1–A5")
    expect(protoWords({ t: "cut", id: "x1", at: "B2", locked: false, by: "router" })).toBe("cut x1 at B2")
    expect(protoWords({ t: "cut", id: "x2", between: ["B2", "B3"], locked: false, by: "router" })).toBe("cut x2 between B2 and B3")
  })
})
