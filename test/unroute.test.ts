import { describe, expect, test } from "vitest"
import type { LayoutEdit } from "../src/core/layout-records.js"
import { startOffLocked, unrouteEdits, unrouteSummary, type UnrouteCopper } from "../src/core/unroute.js"

const COPPER: UnrouteCopper = {
  tracks: [
    { id: "t0001", by: "human", locked: false },
    { id: "t0002", by: "router", locked: false },
    { id: "t0003", by: "router", locked: true },
    { id: "t0004", by: "agent", locked: false },
    { id: "t0005", by: "router", locked: false },
  ],
  vias: [
    { id: "v0001", by: "router", locked: false },
    { id: "v0002", by: "human", locked: false },
  ],
}

describe("Unroute", () => {
  test("takes back only the router's unlocked copper: hand-drawn, the agent's and locked records stay", () => {
    expect(unrouteEdits(COPPER)).toEqual([
      { kind: "removeTrack", id: "t0002" },
      { kind: "removeTrack", id: "t0005" },
      { kind: "removeVia", id: "v0001" },
    ])
  })

  test("with ids, only those of the router's copper among them", () => {
    expect(unrouteEdits(COPPER, ["t0001", "t0003", "t0005", "v0002"])).toEqual([{ kind: "removeTrack", id: "t0005" }])
    expect(unrouteEdits(COPPER, [])).toEqual([])
  })

  test("its summary counts what goes", () => {
    expect(unrouteSummary(unrouteEdits(COPPER))).toBe("Unroute: remove 2 tracks and 1 via the router made")
    expect(unrouteSummary([{ kind: "removeTrack", id: "t1" }])).toBe("Unroute: remove 1 track the router made")
  })
})

describe("router tracks start off locked parts", () => {
  const LOCKED = [{ x: 0, y: 0 }, { x: 10, y: 0 }]
  const lockedAt = (p: { x: number; y: number }) => LOCKED.some((q) => q.x === p.x && q.y === p.y)
  const track = (points: { x: number; y: number }[]): LayoutEdit => ({ kind: "addTrack", net: "net.A", layer: "top", width: 0.2, points })
  const via: LayoutEdit = { kind: "addVia", net: "net.A", at: { x: 5, y: 5 }, drill: 0.3, diameter: 0.6 }

  test("a track starting on a locked pad is turned round; one free at its start and vias stay as they are", () => {
    const edits = [track([{ x: 0, y: 0 }, { x: 5, y: 5 }]), track([{ x: 5, y: 5 }, { x: 0, y: 0 }]), via]
    expect(startOffLocked(edits, lockedAt)).toEqual([track([{ x: 5, y: 5 }, { x: 0, y: 0 }]), track([{ x: 5, y: 5 }, { x: 0, y: 0 }]), via])
  })

  test("a track between two locked pads is split at its middle, each half starting there", () => {
    expect(startOffLocked([track([{ x: 0, y: 0 }, { x: 10, y: 0 }])], lockedAt)).toEqual([track([{ x: 5, y: 0 }, { x: 0, y: 0 }]), track([{ x: 5, y: 0 }, { x: 10, y: 0 }])])
    expect(startOffLocked([track([{ x: 0, y: 0 }, { x: 3, y: 3 }, { x: 7, y: 3 }, { x: 10, y: 0 }])], lockedAt)).toEqual([
      track([{ x: 7, y: 3 }, { x: 3, y: 3 }, { x: 0, y: 0 }]),
      track([{ x: 7, y: 3 }, { x: 10, y: 0 }]),
    ])
  })
})
