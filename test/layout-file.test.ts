import { describe, expect, test } from "vitest"
import {
  circuitPathFor,
  isLayoutFile,
  layoutPathFor,
  nextLayoutId,
  parseLayout,
  readLayoutText,
  serializeLayout,
  type LayoutRecord,
} from "../src/core/layout-file.js"
import { applyLayoutRecordEdits, lockedRecordChanges } from "../src/core/layout-records.js"
import { EditError } from "../src/core/edit-error.js"

const TRACK = '{"t":"track","id":"t0001","net":"GND","layer":"top","width":0.25,"points":[{"x":1,"y":2},{"x":3,"y":2}],"locked":false,"by":"human"}'
const VIA = '{"t":"via","id":"v0001","net":"GND","at":{"x":3,"y":2},"drill":0.3,"diameter":0.6,"layers":["top","bottom"],"locked":false,"by":"agent"}'
const TEXT = `${TRACK}\n${VIA}\n`

const edit = (records: LayoutRecord[], edits: Parameters<typeof applyLayoutRecordEdits>[1], author: "human" | "ai" = "human") =>
  applyLayoutRecordEdits(records, edits, { author })

describe("layout file paths", () => {
  test("the layout file sits beside the circuit file", () => {
    expect(layoutPathFor("boards/main.circuit.tsx")).toBe("boards/main.circuit.layout.json")
    expect(circuitPathFor("boards/main.circuit.layout.json")).toBe("boards/main.circuit.tsx")
    expect(isLayoutFile("boards/main.circuit.layout.json")).toBe(true)
    expect(isLayoutFile("boards/main.circuit.tsx")).toBe(false)
    expect(() => layoutPathFor("main.tsx")).toThrow(/circuit\.tsx/)
  })
})

describe("reading and writing", () => {
  test("a canonical file reads and writes back to the same text", () => {
    const { records, errors } = parseLayout(TEXT)
    expect(errors).toEqual([])
    expect(records.map((r) => r.id)).toEqual(["t0001", "v0001"])
    expect(serializeLayout(records)).toBe(TEXT)
  })

  test("blank lines are skipped and fields are written in a fixed order", () => {
    const shuffled = '\n{"by":"human","locked":false,"points":[{"y":2,"x":1},{"x":3,"y":2}],"width":0.25,"layer":"top","net":"GND","id":"t0001","t":"track"}\n\n'
    expect(serializeLayout(readLayoutText(shuffled))).toBe(`${TRACK}\n`)
  })

  test("locked and by may be left out and read as unlocked and human", () => {
    const [track] = readLayoutText('{"t":"track","id":"t0002","net":"GND","layer":"bottom","width":0.3,"points":[{"x":0,"y":0},{"x":1,"y":0}]}')
    expect(track).toMatchObject({ locked: false, by: "human" })
  })

  test("an empty file has no records", () => {
    expect(readLayoutText("")).toEqual([])
    expect(serializeLayout([])).toBe("")
  })

  test.each([
    ["not json", "line 1 is not valid JSON"],
    ['{"t":"pour","id":"p1"}', 'line 1: t must be "track" or "via"'],
    ['{"t":"track","id":"x1","net":"GND","layer":"top","width":0.25,"points":[{"x":0,"y":0},{"x":1,"y":0}]}', "line 1: id must look like t0001"],
    ['{"t":"track","id":"t0001","net":"GND","layer":"middle","width":0.25,"points":[{"x":0,"y":0},{"x":1,"y":0}]}', "line 1 (t0001): layer must be one of top, bottom, inner1, inner2"],
    ['{"t":"track","id":"t0001","net":"GND","layer":"top","width":0,"points":[{"x":0,"y":0},{"x":1,"y":0}]}', "line 1 (t0001): width must be a number above 0"],
    ['{"t":"track","id":"t0001","net":"GND","layer":"top","width":0.2,"points":[{"x":0,"y":0}]}', "line 1 (t0001): points must hold at least two points"],
    ['{"t":"track","id":"t0001","net":"GND","layer":"top","width":0.2,"points":[{"x":0,"y":0},{"x":"1","y":0}]}', "line 1 (t0001): points[1] must be {x, y} with finite numbers"],
    ['{"t":"track","id":"t0001","net":"GND","layer":"top","width":0.2,"points":[{"x":0,"y":0},{"x":1,"y":0}],"colour":"red"}', "line 1 (t0001): unknown field colour"],
    ['{"t":"track","id":"t0001","net":"","layer":"top","width":0.2,"points":[{"x":0,"y":0},{"x":1,"y":0}]}', "line 1 (t0001): net must be a non-empty string when given"],
    ['{"t":"track","id":"t0001","layer":"top","width":0.2,"points":[{"x":0,"y":0},{"x":1,"y":0}],"by":"robot"}', "line 1 (t0001): by must be one of human, agent, router"],
    ['{"t":"track","id":"t0001","layer":"top","width":0.2,"points":[{"x":0,"y":0},{"x":1,"y":0}],"locked":"yes"}', "line 1 (t0001): locked must be true or false"],
    ['{"t":"via","id":"v0001","at":{"x":0,"y":0},"drill":0.6,"diameter":0.6,"layers":["top","bottom"]}', "line 1 (v0001): diameter must be larger than drill"],
    ['{"t":"via","id":"v0001","at":{"x":0,"y":0},"drill":0.3,"diameter":0.6,"layers":["top","top"]}', "line 1 (v0001): layers must name at least two different layers"],
    ['{"t":"via","id":"v0001","at":{"x":0},"drill":0.3,"diameter":0.6,"layers":["top","bottom"]}', "line 1 (v0001): at must be {x, y} with finite numbers"],
  ])("rejects %s", (line, message) => {
    expect(parseLayout(line).errors).toEqual([message])
    expect(() => readLayoutText(line, "a.circuit.layout.json")).toThrow(`a.circuit.layout.json: ${message}`)
  })

  test("a repeated id is an error and the first record wins", () => {
    const { records, errors } = parseLayout(`${TRACK}\n${TRACK}\n`)
    expect(records).toHaveLength(1)
    expect(errors).toEqual(["line 2: t0001 is used twice"])
  })

  test("valid records are kept next to the errors", () => {
    const { records, errors } = parseLayout(`oops\n${VIA}\n`)
    expect(records.map((r) => r.id)).toEqual(["v0001"])
    expect(errors).toHaveLength(1)
  })
})

describe("ids", () => {
  test("the next id follows the highest of its kind", () => {
    const records = readLayoutText(TEXT.replace('"t0001"', '"t0009"'))
    expect(nextLayoutId(records, "track")).toBe("t0010")
    expect(nextLayoutId(records, "via")).toBe("v0002")
    expect(nextLayoutId([], "track")).toBe("t0001")
  })
})

describe("edits", () => {
  const records = () => readLayoutText(TEXT)

  test("addTrack appends a record with the next id and the author's mark", () => {
    const { records: after, created } = edit(records(), [{ kind: "addTrack", net: "VCC", layer: "bottom", width: 0.3, points: [{ x: 0, y: 0 }, { x: 0, y: 5 }] }], "ai")
    expect(created).toEqual(["t0002"])
    expect(after.at(-1)).toEqual({ t: "track", id: "t0002", net: "VCC", layer: "bottom", width: 0.3, points: [{ x: 0, y: 0 }, { x: 0, y: 5 }], locked: false, by: "agent" })
  })

  test("several adds in one call get consecutive ids", () => {
    const point = (x: number) => ({ x, y: 0 })
    const { created } = edit(records(), [
      { kind: "addTrack", layer: "top", width: 0.2, points: [point(0), point(1)] },
      { kind: "addVia", at: point(1), drill: 0.3, diameter: 0.6 },
      { kind: "addTrack", layer: "bottom", width: 0.2, points: [point(1), point(2)], by: "router" },
    ])
    expect(created).toEqual(["t0002", "v0002", "t0003"])
  })

  test("addVia defaults to the top and bottom layers", () => {
    const { records: after } = edit([], [{ kind: "addVia", net: "GND", at: { x: 1, y: 1 }, drill: 0.3, diameter: 0.6 }])
    expect(after).toEqual([{ t: "via", id: "v0001", net: "GND", at: { x: 1, y: 1 }, drill: 0.3, diameter: 0.6, layers: ["top", "bottom"], locked: false, by: "human" }])
  })

  test("setTrack changes points, width, layer and the lock", () => {
    const points = [{ x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }]
    const { records: after } = edit(records(), [{ kind: "setTrack", id: "t0001", points, width: 0.4, layer: "bottom", locked: true }])
    expect(after[0]).toMatchObject({ points, width: 0.4, layer: "bottom", locked: true })
  })

  test("setVia moves and resizes a via", () => {
    const { records: after } = edit(records(), [{ kind: "setVia", id: "v0001", at: { x: 5, y: 5 }, drill: 0.4, diameter: 0.8 }])
    expect(after[1]).toMatchObject({ at: { x: 5, y: 5 }, drill: 0.4, diameter: 0.8 })
  })

  test("removeTrack and removeVia drop records, and ids are not handed out again below the highest", () => {
    const { records: after } = edit(records(), [{ kind: "removeTrack", id: "t0001" }, { kind: "removeVia", id: "v0001" }])
    expect(after).toEqual([])
  })

  test("an edit naming a missing record or the wrong kind is refused", () => {
    expect(() => edit(records(), [{ kind: "removeTrack", id: "t0042" }])).toThrow(/No track t0042/)
    expect(() => edit(records(), [{ kind: "setTrack", id: "v0001", width: 1 }])).toThrow(/No track v0001/)
    expect(() => edit(records(), [{ kind: "removeVia", id: "t0001" }])).toThrow(EditError)
  })

  test("an edit that makes an invalid record is refused with the reason", () => {
    expect(() => edit(records(), [{ kind: "setTrack", id: "t0001", width: -1 }])).toThrow("t0001: width must be a number above 0")
    expect(() => edit(records(), [{ kind: "addTrack", layer: "top", width: 0.2, points: [{ x: 0, y: 0 }] }])).toThrow(/at least two points/)
  })

  test("a locked record cannot change or go, but a person can unlock it", () => {
    const locked = edit(records(), [{ kind: "setTrack", id: "t0001", locked: true }]).records
    expect(() => edit(locked, [{ kind: "setTrack", id: "t0001", width: 1 }])).toThrow(/t0001 is locked/)
    expect(() => edit(locked, [{ kind: "removeTrack", id: "t0001" }])).toThrow(/t0001 is locked/)
    expect(edit(locked, [{ kind: "setTrack", id: "t0001", locked: false }]).records[0]).toMatchObject({ locked: false })
  })

  test("the agent cannot lock or unlock copper", () => {
    try {
      edit(records(), [{ kind: "setVia", id: "v0001", locked: true }], "ai")
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ code: "locked", message: expect.stringMatching(/only a person/i) })
    }
  })

  test("a track that starts on a locked part's pad counts as locked", () => {
    const lockedStart = (track: { id: string }) => (track.id === "t0001" ? "R1" : undefined)
    expect(() => applyLayoutRecordEdits(records(), [{ kind: "removeTrack", id: "t0001" }], { author: "human", lockedPartAtStart: lockedStart })).toThrow(
      /t0001 starts on the locked part R1/,
    )
  })
})

describe("locked records across texts", () => {
  test("names locked records that change or go away", () => {
    const locked = serializeLayout(edit(readLayoutText(TEXT), [{ kind: "setTrack", id: "t0001", locked: true }]).records)
    expect(lockedRecordChanges(locked, locked)).toBeUndefined()
    expect(lockedRecordChanges(locked, "")).toBe("track t0001")
    expect(lockedRecordChanges(TEXT, "")).toBeUndefined()
    expect(lockedRecordChanges(locked, TEXT)).toBeUndefined()
    expect(lockedRecordChanges(locked, locked.replace('"width":0.25', '"width":0.5'))).toBe("track t0001")
    expect(lockedRecordChanges(locked, TEXT.replace('"width":0.25', '"width":0.5'))).toBeUndefined()
  })
})
