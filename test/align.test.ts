import { describe, expect, test } from "vitest"
import type { PartInfo } from "../src/core/types.js"
import { alignPlan, alignSummary, layoutOffsets, type Boxed } from "../studio/src/pcb/align.js"
import { ALIGN_COMMANDS, alignDisabledReason, partsNeeded, type AlignCommand } from "../studio/src/pcb/align-rules.js"
import type { PartBox } from "../studio/src/pcb/geometry.js"
import type { Layout } from "../studio/src/pcb/group-edits.js"
import { moveBlocker, ZERO, type Anchor, type SourceCircuit } from "../studio/src/pcb/positions.js"

const box = (name: string, minX: number, minY: number, maxX: number, maxY: number): Boxed => ({ name, box: { minX, minY, maxX, maxY } })
const offsetOf = (parts: Boxed[], command: AlignCommand) => Object.fromEntries(layoutOffsets(command, parts))

// Different sizes: a 2x2 at the origin, a wide 4x1, and a tall 1x4 (a part turned a quarter).
const mixed = [box("A", 0, 0, 2, 2), box("B", 5, 3, 9, 4), box("C", 12, -2, 13, 2)]

describe("the eight layouts", () => {
  test("align left puts every left edge on the leftmost", () => {
    expect(offsetOf(mixed, "alignLeft")).toEqual({ B: { x: -5, y: 0 }, C: { x: -12, y: 0 } })
  })
  test("align right puts every right edge on the rightmost", () => {
    expect(offsetOf(mixed, "alignRight")).toEqual({ A: { x: 11, y: 0 }, B: { x: 4, y: 0 } })
  })
  test("align top puts every top edge on the highest (y up)", () => {
    expect(offsetOf([box("A", 0, 0, 1, 1), box("B", 0, 0, 1, 3)], "alignTop")).toEqual({ A: { x: 0, y: 2 } })
    expect(offsetOf(mixed, "alignTop")).toEqual({ A: { x: 0, y: 2 }, C: { x: 0, y: 2 } })
  })
  test("align bottom puts every bottom edge on the lowest", () => {
    expect(offsetOf(mixed, "alignBottom")).toEqual({ A: { x: 0, y: -2 }, B: { x: 0, y: -5 } })
  })
  test("align horizontal centres puts the centres on the selection box's centre y", () => {
    // The selection spans y -2..4, so its centre is 1; A's centre is 1, B's 3.5, C's 0.
    expect(offsetOf(mixed, "alignHCentres")).toEqual({ B: { x: 0, y: -2.5 }, C: { x: 0, y: 1 } })
  })
  test("align vertical centres puts the centres on the selection box's centre x", () => {
    // The selection spans x 0..13, so its centre is 6.5; A's centre is 1, B's 7, C's 12.5.
    expect(offsetOf(mixed, "alignVCentres")).toEqual({ A: { x: 5.5, y: 0 }, B: { x: -0.5, y: 0 }, C: { x: -6, y: 0 } })
  })
  test("distribute horizontally makes the gaps between boxes equal and keeps the ends", () => {
    const uneven = [box("A", 0, 0, 2, 1), box("B", 3, 0, 7, 1), box("C", 12, 0, 13, 1)]
    // gap = (13 - 0 - 7) / 2 = 3, so B starts at 5.
    expect(offsetOf(uneven, "distributeH")).toEqual({ B: { x: 2, y: 0 } })
    expect(offsetOf(mixed, "distributeH")).toEqual({})
  })
  test("distribute vertically uses the bottom and top edges, not the centres", () => {
    const column = [box("A", 0, 0, 1, 1), box("B", 0, 1.5, 1, 5.5), box("C", 0, 9, 1, 10)]
    // gap = (10 - 0 - 6) / 2 = 2, so B spans 3..7.
    expect(offsetOf(column, "distributeV")).toEqual({ B: { x: 0, y: 1.5 } })
  })
  test("distribute orders by position, not by the order given", () => {
    const shuffled = [box("C", 12, 0, 13, 1), box("A", 0, 0, 2, 1), box("B", 3, 0, 7, 1)]
    expect(offsetOf(shuffled, "distributeH")).toEqual({ B: { x: 2, y: 0 } })
  })
  test("distribute spaces overlapping boxes with equal negative gaps", () => {
    const tight = [box("A", 0, 0, 4, 1), box("B", 1, 0, 5, 1), box("C", 2, 0, 6, 1)]
    // gap = (6 - 0 - 12) / 2 = -3, and B starts at 4 - 3 = 1: already there.
    expect(offsetOf(tight, "distributeH")).toEqual({})
  })
  test("two parts: distribute has nothing to space", () => {
    expect(offsetOf([box("A", 0, 0, 1, 1), box("B", 4, 0, 5, 1)], "distributeH")).toEqual({})
  })
})

describe("the enabled rules", () => {
  test("align needs two parts, distribute three", () => {
    expect(ALIGN_COMMANDS.map(partsNeeded)).toEqual([2, 2, 2, 2, 2, 2, 3, 3])
    expect(alignDisabledReason("alignLeft", 1)).toBe("Select two or more parts")
    expect(alignDisabledReason("alignLeft", 2)).toBeNull()
    expect(alignDisabledReason("distributeH", 2)).toBe("Select three or more parts")
    expect(alignDisabledReason("distributeV", 3)).toBeNull()
  })
})

const prop = (literal: number) => ({ literal, source: String(literal), editable: true })
const part = (name: string, x: number, y: number): PartInfo => ({ name, tag: "resistor", line: 1, props: { pcbX: prop(x), pcbY: prop(y) }, editable: true, start: 0, end: 0 })

interface Spec {
  name: string
  x: number
  y: number
  hw: number
  hh: number
}

/** Parts at (x, y) with boxes of half-size (hw, hh), in a layout with a Grid step; `hidden` parts are not drawn. */
function scene(specs: Spec[], step = 0.1, hidden: string[] = []) {
  const circuit: SourceCircuit = { model: { parts: specs.map((s) => part(s.name, s.x, s.y)), traces: [], drawings: [], skipped: [], imports: [] } }
  const shown = specs.filter((s) => !hidden.includes(s.name))
  const anchors = new Map<string, Anchor>(shown.map((s) => [s.name, { origin: { x: s.x, y: s.y }, group: ZERO, autoPlaced: false }]))
  const boxes: PartBox[] = shown.map((s) => ({
    name: s.name,
    pcbComponentId: s.name,
    center: { x: s.x, y: s.y },
    box: { minX: s.x - s.hw, minY: s.y - s.hh, maxX: s.x + s.hw, maxY: s.y + s.hh },
  }))
  const layout: Layout = { anchors, boxes, step }
  return { circuit, layout, blocker: (locked: string[] = []) => (name: string) => moveBlocker(circuit, new Set(locked), name, "pcb") }
}

const written = (plan: ReturnType<typeof alignPlan>) => ("edits" in plan ? plan.edits.map((e) => (e.kind === "setProps" ? [e.part, e.props] : [])) : plan)

describe("alignPlan", () => {
  const specs: Spec[] = [
    { name: "R1", x: 0, y: 0, hw: 1, hh: 0.5 },
    { name: "R2", x: 4, y: 1, hw: 2, hh: 0.5 },
    { name: "R3", x: 10, y: 2, hw: 0.5, hh: 2 },
  ]

  test("align left writes the positions that bring each left edge to the leftmost, in one entry", () => {
    const { circuit, layout, blocker } = scene(specs)
    const plan = alignPlan(circuit, ["R1", "R2", "R3"], "pcb", layout, "alignLeft", blocker())
    // Left edges are -1, 2, 9.5: R2 moves by -3, R3 by -10.5.
    expect(written(plan)).toEqual([
      ["R2", { pcbX: 1, pcbY: 1 }],
      ["R3", { pcbX: -0.5, pcbY: 2 }],
    ])
    expect("summary" in plan && plan.summary).toBe("align R2 and R3 left")
  })

  test("positions are exact, not snapped to the Grid, so edges of different-sized boxes line up to 1e-4", () => {
    const off = scene(
      [
        { name: "A", x: 0, y: 0.03, hw: 1.03, hh: 1 },
        { name: "B", x: 3.04, y: 0.07, hw: 0.37, hh: 1 },
      ],
      0.5,
    )
    const plan = alignPlan(off.circuit, ["A", "B"], "pcb", off.layout, "alignLeft", off.blocker())
    // A's left edge is -1.03; B's centre goes to -1.03 + 0.37 = -0.66.
    expect(written(plan)).toEqual([["B", { pcbX: -0.66, pcbY: 0.07 }]])
    const turned = scene([
      { name: "A", x: 0, y: 0, hw: 1.234, hh: 0.5 },
      { name: "B", x: 6, y: 3, hw: 0.5, hh: 1.777 },
    ])
    const moved = alignPlan(turned.circuit, ["A", "B"], "pcb", turned.layout, "alignTop", turned.blocker())
    if (!("edits" in moved)) throw new Error("expected an edit")
    const y = (moved.edits[0] as unknown as { props: { pcbY: number } }).props.pcbY
    expect(Math.abs(y + 0.5 - (3 + 1.777))).toBeLessThan(1e-4)
  })

  test("a locked leftmost part sets the Align left edge; the others line up to it", () => {
    const { circuit, layout, blocker } = scene(specs)
    const plan = alignPlan(circuit, ["R1", "R2", "R3"], "pcb", layout, "alignLeft", blocker(["R1"]))
    if (!("edits" in plan)) throw new Error("expected an edit")
    expect(plan.parts).toEqual(["R2", "R3"])
    expect(plan.skipped).toEqual([])
    expect(written(plan)).toEqual([["R2", { pcbX: 1, pcbY: 1 }], ["R3", { pcbX: -0.5, pcbY: 2 }]])
  })

  test("a locked part that would have to move stays and is named", () => {
    const { circuit, layout, blocker } = scene(specs)
    const plan = alignPlan(circuit, ["R1", "R2", "R3"], "pcb", layout, "alignLeft", blocker(["R2"]))
    if (!("edits" in plan)) throw new Error("expected an edit")
    expect(plan.parts).toEqual(["R3"])
    expect(plan.skipped).toEqual(["R2 is locked"])
  })

  test("a locked part in the middle of a distribute keeps its place and the others space around the end points", () => {
    const row = scene([
      { name: "A", x: 1, y: 0, hw: 1, hh: 1 },
      { name: "B", x: 4, y: 0, hw: 2, hh: 1 },
      { name: "C", x: 5, y: 0, hw: 0.5, hh: 1 },
      { name: "D", x: 12.5, y: 0, hw: 0.5, hh: 1 },
    ])
    const plan = alignPlan(row.circuit, ["A", "B", "C", "D"], "pcb", row.layout, "distributeH", row.blocker(["B"]))
    if (!("edits" in plan)) throw new Error("expected an edit")
    expect(plan.parts).toEqual(["C"])
    expect(plan.skipped).toEqual(["B is locked and kept its place; others may overlap it"])
  })

  test("the far end is the box that reaches furthest, even when a later box starts further right", () => {
    // A is the leftmost; W starts before N but reaches further right (to 20); N is 9..10.
    const wide = [box("A", 0, 0, 2, 1), box("W", 4, 0, 20, 1), box("N", 9, 0, 10, 1), box("M", 3, 0, 3.5, 1)]
    // Ends A and W stay; widths 2 + 16 + 1 + 0.5 = 19.5 in 20, so 3 gaps of 1/6.
    const offsets = Object.fromEntries(layoutOffsets("distributeH", wide))
    expect(Object.keys(offsets).sort()).toEqual(["M", "N"])
  })

  test("a part with an anchor but no box is named, not dropped", () => {
    const { circuit, layout, blocker } = scene(specs)
    const anchors = new Map(layout.anchors).set("R4", { origin: { x: 20, y: 0 }, group: ZERO, autoPlaced: false })
    const plan = alignPlan(circuit, ["R1", "R2", "R4"], "pcb", { ...layout, anchors }, "alignLeft", blocker())
    if (!("edits" in plan)) throw new Error("expected an edit")
    expect(plan.skipped).toEqual(["R4 has no box in this view"])
  })

  test("a schematic layout (y up, symbol boxes) writes schX and schY", () => {
    const circuit: SourceCircuit = {
      model: {
        parts: ["S1", "S2"].map((name, i) => ({ ...part(name, 0, 0), props: { schX: prop(i * 3), schY: prop(i * 2), schRotation: prop(0) } })),
        traces: [],
        drawings: [],
        skipped: [],
        imports: [],
      },
    }
    const boxes: PartBox[] = [
      { name: "S1", pcbComponentId: "S1", center: { x: 0, y: 0 }, box: { minX: -0.5, minY: -0.25, maxX: 0.5, maxY: 0.25 } },
      { name: "S2", pcbComponentId: "S2", center: { x: 3, y: 2 }, box: { minX: 2, minY: 1, maxX: 4, maxY: 3 } },
    ]
    const anchors = new Map<string, Anchor>(boxes.map((b) => [b.name, { origin: b.center, group: ZERO, autoPlaced: false }]))
    const layout: Layout = { anchors, boxes, step: 0.1 }
    const blocker = (name: string) => moveBlocker(circuit, new Set(), name, "schematic")
    const top = alignPlan(circuit, ["S1", "S2"], "schematic", layout, "alignTop", blocker)
    if (!("edits" in top)) throw new Error("expected an edit")
    expect(top.edits).toEqual([{ kind: "setProps", part: "S1", props: { schX: 0, schY: 2.75 } }])
    expect(top.summary).toBe("align S1 top in the schematic")
  })

  test("with too few parts in the view, nothing is sent and the message says why", () => {
    const { circuit, layout, blocker } = scene(specs, 0.1, ["R2"])
    expect(alignPlan(circuit, ["R1", "R2"], "pcb", layout, "alignLeft", blocker())).toEqual({ message: "Align needs 2 or more parts in this view (R2 is not in this view)." })
    const distribute = alignPlan(circuit, ["R1", "R3"], "pcb", layout, "distributeH", blocker())
    expect("message" in distribute && distribute.message).toContain("Distribute needs 3")
  })

  test("a part the view does not draw is left out and named", () => {
    const { circuit, layout, blocker } = scene(specs, 0.1, ["R3"])
    const plan = alignPlan(circuit, ["R1", "R2", "R3"], "pcb", layout, "alignRight", blocker())
    if (!("edits" in plan)) throw new Error("expected an edit")
    expect(plan.skipped).toEqual(["R3 is not in this view"])
    expect(plan.parts).toEqual(["R1"])
  })

  test("parts already in line give a message, not an empty write", () => {
    const { circuit, layout, blocker } = scene([
      { name: "A", x: 0, y: 0, hw: 1, hh: 1 },
      { name: "B", x: 0, y: 5, hw: 1, hh: 1 },
    ])
    expect(alignPlan(circuit, ["A", "B"], "pcb", layout, "alignVCentres", blocker())).toEqual({ message: "The parts are already there." })
  })

  test("a rotated part's box (tall instead of wide) decides the edge it aligns by", () => {
    const turned = scene([
      { name: "A", x: 0, y: 0, hw: 2, hh: 0.5 },
      { name: "B", x: 6, y: 0, hw: 0.5, hh: 2 },
    ])
    // B's box is 5.5..6.5; its left edge goes to A's, -2, so its centre goes to -1.5.
    expect(written(alignPlan(turned.circuit, ["A", "B"], "pcb", turned.layout, "alignLeft", turned.blocker()))).toEqual([["B", { pcbX: -1.5, pcbY: 0 }]])
  })

  test("the schematic's summary says so", () => {
    expect(alignSummary("distributeV", ["R1", "R2", "R3"], "schematic")).toBe("distribute R1, R2 and R3 vertically in the schematic")
  })
})
