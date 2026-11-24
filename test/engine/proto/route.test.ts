import { describe, expect, test } from "vitest"
import { nextProtoId, type ProtoRecord } from "../../../src/core/layout-proto.js"
import { buildDesign, type Design } from "../../../src/engine/design.js"
import { routeProto, type ProtoDraft } from "../../../src/engine/proto/route.js"

const MAIN = "main.circuit.tsx"
const LAYOUT = "main.circuit.layout.json"

const header = (name: string, pins: number, x: number, y: number) => `<pinheader name="${name}" pinCount={${pins}} pitch="2.54mm" pcbX={${x}} pcbY={${y}} />`
const wire = (pin: string, net: string) => `<trace from="${pin}" to="net.${net}" />`

function build(board: string, body: readonly string[], records: readonly ProtoRecord[] = []): Design {
  const circuit = `export default () => (\n  <board ${board}>\n${body.join("\n")}\n  </board>\n)\n`
  return buildDesign({ [MAIN]: circuit, [LAYOUT]: records.map((r) => JSON.stringify(r)).join("\n") }, MAIN)
}

/** The drafts as records with ids, after those already there. */
function asRecords(drafts: readonly ProtoDraft[], before: readonly ProtoRecord[] = []): ProtoRecord[] {
  const records = [...before]
  for (const draft of drafts) records.push({ ...draft, id: nextProtoId(records, draft.t), locked: false, by: "router" } as ProtoRecord)
  return records
}

function route(board: string, body: readonly string[], before: readonly ProtoRecord[] = [], nets?: string[]) {
  const built = build(board, body, before)
  const grid = built.pcb.board?.proto
  if (!grid) throw new Error("not a proto board")
  const report = routeProto({ grid, parts: built.pcb.parts, records: built.pcb.proto ?? [], ...(nets ? { nets } : {}) })
  const records = asRecords(report.drafts, before)
  return { report, records, after: build(board, body, records) }
}

const errors = (built: Design) => built.violations.filter((v) => v.code.startsWith("proto-")).map((v) => `${v.code}: ${v.message}`)

// J1 in C2–C4 and J2 in E2–E4 on a 10 x 6 board.
const TWO_HEADERS = [header("J1", 3, -6.35, 1.27), header("J2", 3, -6.35, -3.81)]
const STRAIGHT = [...TWO_HEADERS, wire("J1.pin1", "A"), wire("J2.pin1", "A"), wire("J1.pin3", "B"), wire("J2.pin3", "B")]
// A crosses B: J1.pin1 to J2.pin3, J1.pin3 to J2.pin1.
const CROSSED = [...TWO_HEADERS, wire("J1.pin1", "A"), wire("J2.pin3", "A"), wire("J1.pin3", "B"), wire("J2.pin1", "B")]
const PERF = 'kind="perfboard" columns={10} rows={6}'
const STRIP = 'kind="stripboard" columns={10} rows={6}'

describe("perfboard", () => {
  test("straight connections become solder runs down the columns", () => {
    const { report, after } = route(PERF, STRAIGHT)
    expect(report.unrouted).toEqual([])
    expect(report.total).toBe(2)
    expect(report.links).toBe(0)
    expect(report.drafts).toEqual([
      { t: "solder", net: "net.A", holes: ["C2", "D2", "E2"] },
      { t: "solder", net: "net.B", holes: ["C4", "D4", "E4"] },
    ])
    expect(errors(after)).toEqual([])
    expect(after.pcb.ratsnest).toEqual([])
  })

  test("crossing nets are joined without a short, by a detour or a link", () => {
    const { report, after } = route(PERF, CROSSED)
    expect(report.unrouted).toEqual([])
    expect(errors(after)).toEqual([])
    expect(after.pcb.ratsnest).toEqual([])
  })

  test("a link is used where solder cannot pass", () => {
    // Net Q's solder fills row D from end to end: A and B can only cross it with a link over it.
    const body = [header("K1", 1, -11.43, -1.27), header("K2", 1, 11.43, -1.27), wire("K1.pin1", "Q"), wire("K2.pin1", "Q"), ...STRAIGHT]
    const row: ProtoRecord = { t: "solder", id: "s1", holes: Array.from({ length: 10 }, (_, i) => `D${i + 1}`), locked: false, by: "human" }
    const { report, after } = route(PERF, body, [row])
    expect(report.unrouted).toEqual([])
    expect(report.links).toBe(2)
    // Column 1 is closed by K1's leg in D1, so each net steps off its pin and links over row D further along.
    const links = report.drafts.filter((d) => d.t === "link")
    expect(links.every((d) => d.t === "link" && d.from < "D" && d.to > "E" && d.from.slice(1) === d.to.slice(1))).toBe(true)
    expect(errors(after)).toEqual([])
  })

  test("a net with no way through is named with the reason", () => {
    // J1 boxed in by a ring: its pins cannot leave row C.
    const walls = [header("W1", 10, 0, 3.81), header("W2", 10, 0, -1.27), ...STRAIGHT]
    const { report } = route(PERF, walls)
    expect(report.unrouted.length).toBeGreaterThan(0)
    expect(report.unrouted[0]?.reason).toMatch(/no free path/)
  })

  test("only the nets asked for are routed, and what is there is kept", () => {
    const first = route(PERF, STRAIGHT, [], ["net.A"])
    expect(first.report.drafts.map((d) => ("net" in d ? d.net : ""))).toEqual(["net.A"])
    const second = route(PERF, STRAIGHT, first.records)
    expect(second.report.total).toBe(1)
    expect(second.report.drafts.map((d) => ("net" in d ? d.net : ""))).toEqual(["net.B"])
    expect(errors(second.after)).toEqual([])
  })

  test("is the same every time", () => {
    expect(route(PERF, CROSSED).report).toEqual(route(PERF, CROSSED).report)
  })
})

describe("stripboard", () => {
  test("pins on one strip get cuts between them and links across the strips", () => {
    const { report, after } = route(STRIP, STRAIGHT)
    expect(report.unrouted).toEqual([])
    expect(report.links).toBe(2)
    expect(report.cuts).toBeGreaterThanOrEqual(2)
    expect(report.drafts.some((d) => d.t === "solder")).toBe(false)
    expect(errors(after)).toEqual([])
    expect(after.pcb.ratsnest).toEqual([])
  })

  test("crossing nets too", () => {
    const { report, after } = route(STRIP, CROSSED)
    expect(report.unrouted).toEqual([])
    expect(errors(after)).toEqual([])
    expect(after.pcb.ratsnest).toEqual([])
  })

  test("a pin with no net is cut away from its neighbours", () => {
    // J1.pin2 and J2.pin2 have no net: each sits between A and B on its strip.
    const { after } = route(STRIP, STRAIGHT)
    const holes = new Set((after.pcb.proto ?? []).flatMap((r) => (r.t === "cut" ? (r.at ? [r.at] : (r.between ?? [])) : [])))
    expect([...holes].some((hole) => hole.startsWith("C"))).toBe(true)
    expect([...holes].some((hole) => hole.startsWith("E"))).toBe(true)
  })

  test("strips down the columns", () => {
    const { report, after } = route(`${STRIP} strips="columns"`, CROSSED)
    expect(report.unrouted).toEqual([])
    expect(errors(after)).toEqual([])
  })

  test("routes again on top of its own work without new cuts where none are needed", () => {
    const first = route(STRIP, STRAIGHT, [], ["net.A"])
    const second = route(STRIP, STRAIGHT, first.records)
    expect(second.report.unrouted).toEqual([])
    expect(errors(second.after)).toEqual([])
  })
})
