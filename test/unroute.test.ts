import { describe, expect, test } from "vitest"
import type { LayoutEdit } from "../src/core/layout-records.js"
import { parseLayout } from "../src/core/layout-file.js"
import { applyLayoutRecordEdits } from "../src/core/layout-records.js"
import { startOffLocked, unrouteEdits, unrouteSummary, type UnrouteCopper } from "../src/core/unroute.js"

const COPPER: UnrouteCopper = {
  tracks: [
    { id: "t0001", by: "human", locked: false, layer: "top", points: [] },
    { id: "t0002", by: "router", locked: false, layer: "top", points: [] },
    { id: "t0003", by: "router", locked: true, layer: "top", points: [] },
    { id: "t0004", by: "agent", locked: false, layer: "top", points: [] },
    { id: "t0005", by: "router", locked: false, layer: "top", points: [] },
  ],
  vias: [
    { id: "v0001", by: "router", locked: false },
    { id: "v0002", by: "human", locked: false },
  ],
}

describe("Unroute", () => {
  test("takes back only the router's unlocked copper: hand-drawn, the agent's and locked records stay", () => {
    expect(unrouteEdits(COPPER).edits).toEqual([
      { kind: "removeTrack", id: "t0002" },
      { kind: "removeTrack", id: "t0005" },
      { kind: "removeVia", id: "v0001" },
    ])
  })

  test("with ids, only those of the router's copper among them", () => {
    expect(unrouteEdits(COPPER, { ids: ["t0001", "t0003", "t0005", "v0002"] }).edits).toEqual([{ kind: "removeTrack", id: "t0005" }])
    expect(unrouteEdits(COPPER, { ids: [] }).edits).toEqual([])
  })

  test("a router track that starts on a part locked since is left, and named", () => {
    const result = unrouteEdits(COPPER, { lockedPart: (track) => (track.id === "t0005" ? "J1" : undefined) })
    expect(result).toEqual({ edits: [{ kind: "removeTrack", id: "t0002" }, { kind: "removeVia", id: "v0001" }], skipped: ["t0005 starts on the locked part J1"], kept: [] })
    expect(unrouteSummary(result.edits, result.skipped)).toBe("Unroute: remove 1 track and 1 via the router made; left t0005 (starts on the locked part J1)")
  })

  test("its summary counts what goes", () => {
    expect(unrouteSummary(unrouteEdits(COPPER).edits)).toBe("Unroute: remove 2 tracks and 1 via the router made")
    expect(unrouteSummary([{ kind: "removeTrack", id: "t1" }])).toBe("Unroute: remove 1 track the router made")
  })

  test("a router record reshaped by hand becomes the editor's, so Unroute leaves it; a lock change alone keeps the maker", () => {
    const routed = applyLayoutRecordEdits(parseLayout(""), [
      { kind: "addTrack", net: "net.A", layer: "top", width: 0.2, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
      { kind: "addVia", net: "net.A", at: { x: 1, y: 0 }, drill: 0.3, diameter: 0.6 },
      { kind: "addTrack", net: "net.A", layer: "top", width: 0.2, points: [{ x: 2, y: 0 }, { x: 3, y: 0 }] },
    ], { author: "human", router: true }).doc
    const edited = applyLayoutRecordEdits(routed, [
      { kind: "setTrack", id: "t0001", points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }] },
      { kind: "setVia", id: "v0001", at: { x: 1.1, y: 0 } },
      { kind: "setTrack", id: "t0002", locked: false },
    ], { author: "human" }).doc
    expect(edited.records.map((record) => [record.id, record.by])).toEqual([["t0001", "human"], ["v0001", "human"], ["t0002", "router"]])
  })

  test("a router via that a track not made by the router touches is kept, and the summary counts it", () => {
    const routed = applyLayoutRecordEdits(parseLayout(""), [
      { kind: "addTrack", net: "net.A", layer: "top", width: 0.2, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
      { kind: "addVia", net: "net.A", at: { x: 1, y: 0 }, drill: 0.3, diameter: 0.6 },
      { kind: "addTrack", net: "net.A", layer: "bottom", width: 0.2, points: [{ x: 1, y: 0 }, { x: 3, y: 0 }] },
      { kind: "addVia", net: "net.A", at: { x: 3, y: 0 }, drill: 0.3, diameter: 0.6 },
      { kind: "addTrack", net: "net.A", layer: "top", width: 0.2, points: [{ x: 3, y: 0 }, { x: 5, y: 0 }] },
    ], { author: "human", router: true }).doc
    // The first track is reshaped by hand, its end still on the router's via v0001; v0002 touches router tracks only.
    const edited = applyLayoutRecordEdits(routed, [{ kind: "setTrack", id: "t0001", points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.4 }, { x: 1.05, y: 0 }] }], { author: "human" }).doc
    const tracks = edited.records.filter((record) => record.t === "track")
    const vias = edited.records.filter((record) => record.t === "via")
    const result = unrouteEdits({ tracks, vias })
    expect(result.edits).toEqual([
      { kind: "removeTrack", id: "t0002" },
      { kind: "removeTrack", id: "t0003" },
      { kind: "removeVia", id: "v0002" },
    ])
    expect(result.kept).toEqual(["v0001"])
    expect(unrouteSummary(result.edits, result.skipped, result.kept.length)).toBe("Unroute: remove 2 tracks and 1 via the router made; kept 1 via a track not made by the router touches")
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
