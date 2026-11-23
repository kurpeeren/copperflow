import { describe, expect, test } from "vitest"
import { parseLayout, readLayoutText, serializeLayout } from "../src/core/layout-file.js"
import { applyLayoutRecordEdits } from "../src/core/layout-records.js"
import { checkReference, nextReferenceId, serializeReferences, type ReferenceRecord } from "../src/core/layout-references.js"

const TRACK = '{"t":"track","id":"t0001","net":"GND","layer":"top","width":0.25,"points":[{"x":1,"y":2},{"x":3,"y":2}],"locked":false,"by":"human"}'
const REFERENCE =
  '{"t":"reference","id":"r1","file":"references/bottom.jpg","width":1200,"height":1600,"mirror":true,"points":[{"image":{"x":213,"y":297},"board":{"x":-60.31,"y":50.02}}],"opacity":0.4,"shown":true}'

describe("reference lines in the layout file", () => {
  test("are read apart from the copper and written back after it", () => {
    const text = `${REFERENCE}\n${TRACK}\n`
    const doc = readLayoutText(text)
    expect(doc.records.map((r) => r.id)).toEqual(["t0001"])
    expect(doc.references?.[0]).toMatchObject({ id: "r1", mirror: true, opacity: 0.4, points: [{ image: { x: 213, y: 297 } }] })
    expect(serializeLayout(doc)).toBe(`{"t":"meta","next":{"track":2,"via":1}}\n${TRACK}\n${REFERENCE}\n`)
  })

  test("a file without them has none, and copper edits keep them", () => {
    expect(readLayoutText(`${TRACK}\n`).references).toBeUndefined()
    const doc = readLayoutText(`${REFERENCE}\n`)
    const { doc: after } = applyLayoutRecordEdits(doc, [{ kind: "addTrack", layer: "top", width: 0.3, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }], { author: "human" })
    expect(after.references).toEqual(doc.references)
  })

  test("defaults fill in and a bad line is named", () => {
    const made = checkReference({ t: "reference", id: "r2", file: "references/a.png", width: 10, height: 20 })
    expect(made).toEqual({ record: { t: "reference", id: "r2", file: "references/a.png", width: 10, height: 20, mirror: false, points: [], opacity: 0.5, shown: true } })
    const { errors } = parseLayout(
      [
        '{"t":"reference","id":"x","file":"references/a.png","width":1,"height":1}',
        '{"t":"reference","id":"r3","file":"elsewhere/a.png","width":0,"height":1,"opacity":2,"mirror":"yes","shown":1,"pixel":-1,"source":"","extra":1}',
        '{"t":"reference","id":"r4","file":"references/a.png","width":1,"height":1,"points":[{"image":{"x":1},"board":{"x":1,"y":2}}]}',
        '{"t":"reference","id":"r5","file":"references/a.png","width":1,"height":1,"points":{}}',
        '{"t":"reference","id":"r1","file":"references/a.png","width":1,"height":1}',
        '{"t":"reference","id":"r1","file":"references/a.png","width":1,"height":1}',
      ].join("\n"),
    )
    expect(errors[0]).toMatch(/line 1: id must look like r1/)
    expect(errors[1]).toMatch(/line 2 \(r3\): unknown field extra; file must be .*; source.*; width and height.*; mirror.*; shown.*; pixel.*; opacity/)
    expect(errors[2]).toMatch(/points\[0\] must be/)
    expect(errors[3]).toMatch(/points must be a list/)
    expect(errors[4]).toMatch(/line 6: r1 is used twice/)
  })

  test("too many points are refused", () => {
    const point = { image: { x: 1, y: 1 }, board: { x: 1, y: 1 } }
    const result = checkReference({ t: "reference", id: "r1", file: "references/a.svg", width: 1, height: 1, points: Array.from({ length: 21 }, () => point) })
    expect(result).toMatchObject({ problems: ["points may hold at most 20 pairs"] })
  })

  test("ids count up from the highest", () => {
    const one = (id: string) => ({ id }) as ReferenceRecord
    expect(nextReferenceId([])).toBe("r1")
    expect(nextReferenceId([one("r2"), one("r7")])).toBe("r8")
  })

  test("optional fields are written only when set", () => {
    const record = (checkReference({ t: "reference", id: "r1", file: "references/top.svg", source: "top.gtl", width: 4, height: 2, pixel: 0.05 }) as { record: ReferenceRecord }).record
    expect(serializeReferences([record])).toBe('{"t":"reference","id":"r1","file":"references/top.svg","source":"top.gtl","width":4,"height":2,"mirror":false,"points":[],"pixel":0.05,"opacity":0.5,"shown":true}\n')
  })
})
