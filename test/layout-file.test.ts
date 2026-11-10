import { describe, expect, test } from "vitest"
import {
  circuitPathFor,
  EMPTY_LAYOUT,
  isLayoutFile,
  layoutPathFor,
  nextLayoutId,
  parseLayout,
  readLayoutText,
  serializeLayout,
  type LayoutDoc,
} from "../src/core/layout-file.js"
import { applyLayoutRecordEdits, lockedPartChanges, lockedRecordChanges, type LayoutEdit } from "../src/core/layout-records.js"
import { EditError } from "../src/core/edit-error.js"

const META = '{"t":"meta","next":{"track":2,"via":2}}'
const TRACK = '{"t":"track","id":"t0001","net":"GND","layer":"top","width":0.25,"points":[{"x":1,"y":2},{"x":3,"y":2}],"locked":false,"by":"human"}'
const VIA = '{"t":"via","id":"v0001","net":"GND","at":{"x":3,"y":2},"drill":0.3,"diameter":0.6,"layers":["top","bottom"],"locked":false,"by":"agent"}'
const TEXT = `${META}\n${TRACK}\n${VIA}\n`

const edit = (doc: LayoutDoc, edits: LayoutEdit[], author: "human" | "ai" = "human") => applyLayoutRecordEdits(doc, edits, { author })
const records = () => readLayoutText(TEXT)

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
    const { records: read, next, errors } = parseLayout(TEXT)
    expect(errors).toEqual([])
    expect(read.map((r) => r.id)).toEqual(["t0001", "v0001"])
    expect(serializeLayout({ next, records: read })).toBe(TEXT)
  })

  test("blank lines are skipped and fields are written in a fixed order", () => {
    const shuffled = '\n{"by":"human","locked":false,"points":[{"y":2,"x":1},{"x":3,"y":2}],"width":0.25,"layer":"top","net":"GND","id":"t0001","t":"track"}\n\n'
    expect(serializeLayout(readLayoutText(shuffled))).toBe(`{"t":"meta","next":{"track":2,"via":1}}\n${TRACK}\n`)
  })

  test("locked and by may be left out and read as unlocked and human", () => {
    const [track] = readLayoutText('{"t":"track","id":"t0002","net":"GND","layer":"bottom","width":0.3,"points":[{"x":0,"y":0},{"x":1,"y":0}]}').records
    expect(track).toMatchObject({ locked: false, by: "human" })
  })

  test("an empty file has no records and writes back empty", () => {
    expect(readLayoutText("")).toEqual(EMPTY_LAYOUT)
    expect(serializeLayout(EMPTY_LAYOUT)).toBe("")
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
    ['{"t":"meta","next":{"track":0,"via":1}}', "line 1 (meta): next must be {track, via} with whole numbers from 1"],
    ['{"t":"meta","next":{"track":1,"via":1},"x":1}', "line 1 (meta): unknown field x"],
  ])("rejects %s", (line, message) => {
    expect(parseLayout(line).errors).toEqual([message])
    expect(() => readLayoutText(line, "a.circuit.layout.json")).toThrow(`a.circuit.layout.json: ${message}`)
  })

  test("the meta line may only come first", () => {
    expect(parseLayout(`${TRACK}\n${META}\n`).errors).toEqual(["line 2: the meta line must be the first line"])
  })

  test("a repeated id is an error and the first record wins", () => {
    const { records: read, errors } = parseLayout(`${TRACK}\n${TRACK}\n`)
    expect(read).toHaveLength(1)
    expect(errors).toEqual(["line 2: t0001 is used twice"])
  })

  test("valid records are kept next to the errors", () => {
    const { records: read, errors } = parseLayout(`oops\n${VIA}\n`)
    expect(read.map((r) => r.id)).toEqual(["v0001"])
    expect(errors).toHaveLength(1)
  })
})

describe("ids", () => {
  test("the next id follows the meta line, raised past every id in the file", () => {
    const doc = readLayoutText(TEXT.replace('"t0001"', '"t0009"'))
    expect(nextLayoutId(doc, "track")).toBe("t0010")
    expect(nextLayoutId(doc, "via")).toBe("v0002")
    expect(nextLayoutId(readLayoutText('{"t":"meta","next":{"track":40,"via":7}}'), "track")).toBe("t0040")
    expect(nextLayoutId(EMPTY_LAYOUT, "track")).toBe("t0001")
  })

  test("removing the highest id does not hand it out again, and the meta line stays when every record is gone", () => {
    const removed = edit(records(), [{ kind: "removeTrack", id: "t0001" }, { kind: "removeVia", id: "v0001" }]).doc
    expect(serializeLayout(removed)).toBe(`${META}\n`)
    const again = edit(readLayoutText(serializeLayout(removed)), [{ kind: "addTrack", layer: "top", width: 0.2, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }])
    expect(again.created).toEqual(["t0002"])
  })
})

describe("edits", () => {
  test("addTrack appends a record with the next id and the author's mark", () => {
    const { doc, created } = edit(records(), [{ kind: "addTrack", net: "VCC", layer: "bottom", width: 0.3, points: [{ x: 0, y: 0 }, { x: 0, y: 5 }] }], "ai")
    expect(created).toEqual(["t0002"])
    expect(doc.records.at(-1)).toEqual({ t: "track", id: "t0002", net: "VCC", layer: "bottom", width: 0.3, points: [{ x: 0, y: 0 }, { x: 0, y: 5 }], locked: false, by: "agent" })
    expect(doc.next).toEqual({ track: 3, via: 2 })
  })

  test("several adds in one call get consecutive ids; the router's path marks its records", () => {
    const point = (x: number) => ({ x, y: 0 })
    const { doc, created } = applyLayoutRecordEdits(
      records(),
      [
        { kind: "addTrack", layer: "top", width: 0.2, points: [point(0), point(1)] },
        { kind: "addVia", at: point(1), drill: 0.3, diameter: 0.6 },
        { kind: "addTrack", layer: "bottom", width: 0.2, points: [point(1), point(2)] },
      ],
      { author: "ai", router: true },
    )
    expect(created).toEqual(["t0002", "v0002", "t0003"])
    expect(doc.records.slice(2).map((r) => r.by)).toEqual(["router", "router", "router"])
  })

  test("addVia defaults to the top and bottom layers", () => {
    const { doc } = edit(EMPTY_LAYOUT, [{ kind: "addVia", net: "GND", at: { x: 1, y: 1 }, drill: 0.3, diameter: 0.6 }])
    expect(doc.records).toEqual([{ t: "via", id: "v0001", net: "GND", at: { x: 1, y: 1 }, drill: 0.3, diameter: 0.6, layers: ["top", "bottom"], locked: false, by: "human" }])
  })

  test("setTrack changes points, width, layer and the lock", () => {
    const points = [{ x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }]
    const { doc } = edit(records(), [{ kind: "setTrack", id: "t0001", points, width: 0.4, layer: "bottom", locked: true }])
    expect(doc.records[0]).toMatchObject({ points, width: 0.4, layer: "bottom", locked: true })
  })

  test("setVia moves and resizes a via", () => {
    const { doc } = edit(records(), [{ kind: "setVia", id: "v0001", at: { x: 5, y: 5 }, drill: 0.4, diameter: 0.8 }])
    expect(doc.records[1]).toMatchObject({ at: { x: 5, y: 5 }, drill: 0.4, diameter: 0.8 })
  })

  test("removeTrack and removeVia drop records", () => {
    expect(edit(records(), [{ kind: "removeTrack", id: "t0001" }, { kind: "removeVia", id: "v0001" }]).doc.records).toEqual([])
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

  test.each([
    [{ kind: "setTrack", id: "t0001", by: "router" }, "setTrack cannot set by; it takes id, net, layer, width, points, locked"],
    [{ kind: "setTrack", id: "t0001", drill: 0.3 }, "setTrack cannot set drill"],
    [{ kind: "setVia", id: "v0001", t: "track" }, "setVia cannot set t"],
    [{ kind: "addTrack", layer: "top", width: 0.2, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], by: "human" }, "addTrack cannot set by"],
    [{ kind: "addVia", at: { x: 0, y: 0 }, drill: 0.3, diameter: 0.6, id: "v0001" }, "addVia cannot set id"],
    [{ kind: "moveTrack", id: "t0001" }, "Unknown layout edit moveTrack"],
  ])("an edit with a field its kind may not set is refused: %o", (bad, message) => {
    expect(() => edit(records(), [bad as unknown as LayoutEdit], "ai")).toThrow(message)
  })

  test("a locked record cannot change or go, but a person can unlock it", () => {
    const locked = edit(records(), [{ kind: "setTrack", id: "t0001", locked: true }]).doc
    expect(() => edit(locked, [{ kind: "setTrack", id: "t0001", width: 1 }])).toThrow(/t0001 is locked/)
    expect(() => edit(locked, [{ kind: "removeTrack", id: "t0001" }])).toThrow(/t0001 is locked/)
    expect(edit(locked, [{ kind: "setTrack", id: "t0001", locked: false }]).doc.records[0]).toMatchObject({ locked: false })
  })

  test("the agent cannot lock or unlock copper", () => {
    try {
      edit(records(), [{ kind: "setVia", id: "v0001", locked: true }], "ai")
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ code: "locked", message: expect.stringMatching(/only a person/i) })
    }
  })
})

describe("tracks on a locked part", () => {
  /** The part R1's pad covers x < 2. */
  const onR1 = (track: { points: { x: number }[] }) => ((track.points[0]?.x ?? 99) < 2 ? "R1" : undefined)
  const context = { author: "human" as const, lockedPartAtStart: onR1 }
  const run = (edits: LayoutEdit[]) => applyLayoutRecordEdits(records(), edits, context)

  test("changing or removing a track that starts there is refused", () => {
    expect(() => run([{ kind: "removeTrack", id: "t0001" }])).toThrow(/t0001 starts on the locked part R1/)
    expect(() => run([{ kind: "setTrack", id: "t0001", width: 0.5 }])).toThrow(/t0001 starts on the locked part R1/)
  })

  test("adding a track that starts there, or moving a track's start onto it, is refused", () => {
    const points = [{ x: 0, y: 0 }, { x: 5, y: 0 }]
    expect(() => run([{ kind: "addTrack", layer: "top", width: 0.2, points }])).toThrow(/t0002 starts on the locked part R1/)
    const elsewhere = applyLayoutRecordEdits(records(), [{ kind: "addTrack", layer: "top", width: 0.2, points: [{ x: 5, y: 0 }, { x: 0, y: 0 }] }], context)
    expect(elsewhere.created).toEqual(["t0002"])
    expect(() => applyLayoutRecordEdits(elsewhere.doc, [{ kind: "setTrack", id: "t0002", points }], context)).toThrow(/t0002 starts on the locked part R1/)
  })

  test("a person may still lock or unlock such a track", () => {
    expect(run([{ kind: "setTrack", id: "t0001", locked: true }]).doc.records[0]).toMatchObject({ locked: true })
  })
})

describe("locks across texts", () => {
  test("names locked records that change or go away", () => {
    const locked = serializeLayout(edit(records(), [{ kind: "setTrack", id: "t0001", locked: true }]).doc)
    expect(lockedRecordChanges(locked, locked)).toBeUndefined()
    expect(lockedRecordChanges(locked, "")).toBe("track t0001")
    expect(lockedRecordChanges(TEXT, "")).toBeUndefined()
    expect(lockedRecordChanges(locked, TEXT)).toBeUndefined()
    expect(lockedRecordChanges(locked, locked.replace('"width":0.25', '"width":0.5'))).toBe("track t0001")
    expect(lockedRecordChanges(locked, TEXT.replace('"width":0.25', '"width":0.5'))).toBeUndefined()
  })

  test("names tracks on a locked part that are added, changed or removed", () => {
    const onR1 = (track: { id: string }) => (track.id === "t0001" ? "R1" : undefined)
    expect(lockedPartChanges(TEXT, TEXT, onR1)).toBeUndefined()
    expect(lockedPartChanges(TEXT, "", onR1)).toBe("track t0001 (on the locked part R1)")
    expect(lockedPartChanges("", TEXT, onR1)).toBe("track t0001 (on the locked part R1)")
    expect(lockedPartChanges(TEXT, TEXT.replace('"width":0.25', '"width":0.5'), onR1)).toBe("track t0001 (on the locked part R1)")
    expect(lockedPartChanges(TEXT, TEXT.replace(`${VIA}\n`, ""), onR1)).toBeUndefined()
  })
})
