import { describe, expect, test } from "vitest"
import { serializeLayout, type TrackRecord, type ViaRecord } from "../src/core/layout-file.js"
import { buildDesign } from "../src/engine/design.js"
import type { RouteEvent } from "../src/studio/route-events.js"
import { checkRows } from "../studio/src/checks-list.js"
import { netScope, selectionScope, unrouteRequest } from "../studio/src/pcb/autoroute.js"

const MAIN = "main.circuit.tsx"
const SHEET = "PowerStage.sheet.tsx"
const POWER = `export default function PowerStage() {
  return (
    <sheet>
      <port name="VIN" />
      <port name="VOUT" />
      <resistor name="R1" footprint="0402" pcbX={0} pcbY={0} />
      <resistor name="R2" footprint="0402" pcbX={0} pcbY={3} />
      <trace from="R1.pin1" to="net.VIN" />
      <trace from="R1.pin2" to="net.MID" />
      <trace from="R2.pin1" to="net.MID" />
      <trace from="R2.pin2" to="net.VOUT" />
    </sheet>
  )
}
`
const MAIN_TEXT = `import PowerStage from "./PowerStage.sheet"
export default () => (
  <board width="40mm" height="40mm">
    <PowerStage name="PS1" connections={{ VIN: "VBUS", VOUT: "V3_3" }} pcbX={-10} pcbY={0} />
    <PowerStage name="PS2" connections={{ VIN: "V3_3", VOUT: "V1_8" }} pcbX={10} pcbY={0} />
    <resistor name="R1" footprint="0402" pcbX={0} pcbY={-10} />
    <resistor name="R2" footprint="0402" pcbX={4} pcbY={-10} />
    <trace from="R1.pin1" to="R2.pin1" />
  </board>
)
`
const track = (id: string, by: TrackRecord["by"], locked = false): TrackRecord => ({ t: "track", id, layer: "top", width: 0.2, points: [{ x: -15, y: 15 }, { x: -12, y: 15 }], locked, by })
const via = (id: string, by: ViaRecord["by"]): ViaRecord => ({ t: "via", id, at: { x: 15, y: 15 }, drill: 0.3, diameter: 0.6, layers: ["top", "bottom"], locked: false, by })

function design(records: (TrackRecord | ViaRecord)[] = []) {
  const files: Record<string, string> = { [MAIN]: MAIN_TEXT, [SHEET]: POWER }
  if (records.length > 0) files["main.circuit.layout.json"] = serializeLayout({ next: { track: 9, via: 9 }, records })
  return buildDesign(files, MAIN)
}

describe("what Autoroute selection and Autoroute net route", () => {
  const built = design()

  test("parts route their own connections; an instance's symbol or all of its parts route as the instance", () => {
    expect(selectionScope(built, ["R1", "R2"])).toEqual({ kind: "parts", parts: ["R1", "R2"] })
    expect(selectionScope(built, ["PS1"])).toEqual({ kind: "instance", instance: "PS1" })
    expect(selectionScope(built, ["R102", "R101"])).toEqual({ kind: "instance", instance: "PS1" })
    expect(selectionScope(built, ["R101"])).toEqual({ kind: "parts", parts: ["R101"] })
    expect(selectionScope(built, ["R101", "R102", "R1"])).toEqual({ kind: "parts", parts: ["R101", "R102", "R1"] })
    expect(selectionScope(built, [])).toEqual({ message: "Select parts, or a sub-sheet instance, to route their connections." })
  })

  test("Autoroute net takes the highlighted net, the Nets panel's row", () => {
    expect(netScope(["net.GND"])).toEqual({ kind: "nets", nets: ["net.GND"] })
    expect(netScope([])).toEqual({ message: "Click a net in the Nets panel to highlight it, then Autoroute net." })
  })
})

describe("what Unroute asks for", () => {
  test("nothing selected: all the router's copper; selected copper: the router's among it; hand copper alone: nothing", () => {
    const built = design([track("t0001", "human"), track("t0002", "router"), track("t0003", "router", true), via("v0001", "router")])
    expect(unrouteRequest(built, [])).toEqual({})
    expect(unrouteRequest(built, ["t0001", "t0002"])).toEqual({ ids: ["t0001", "t0002"] })
    expect(unrouteRequest(built, ["t0001", "t0003"])).toEqual({ message: "None of the selected copper was made by the router and unlocked; Unroute removes only that." })
    expect(unrouteRequest(design([track("t0001", "human")]), [])).toEqual({ message: "The board has no unlocked router copper to remove." })
    expect(unrouteRequest(undefined, [])).toEqual({ message: "Wait for the build to finish, then try again." })
  })

  test("a router track starting on a locked part (or on a part of a locked instance) counts as locked, as the core counts it", () => {
    const pads = design().pcb.parts.flatMap((part) => part.pads)
    const at = (id: string) => pads.find((pad) => pad.id === id)!
    const from = (id: string, pad: string): TrackRecord => ({ ...track(id, "router"), points: [{ x: at(pad).x, y: at(pad).y }, { x: at(pad).x, y: at(pad).y + 2 }] })
    const built = design([from("t0001", "R1#1"), from("t0002", "R101#1")])
    expect(unrouteRequest(built, [])).toEqual({})
    expect(unrouteRequest(built, [], new Set(["R1"]))).toEqual({})
    expect(unrouteRequest(built, [], new Set(["R1", "PS1"]))).toEqual({
      message: "The board has no unlocked router copper to remove: t0001 starts on the locked part R1; t0002 starts on the locked part R101.",
    })
    expect(unrouteRequest(built, ["t0001"], new Set(["R1"]))).toEqual({ message: "None of the selected copper was made by the router and unlocked; Unroute removes only that: t0001 starts on the locked part R1." })
  })
})

describe("the Checks list after a run", () => {
  test("shows each connection the router could not route, with its reason, while it is still not routed", () => {
    const built = design()
    const [line] = built.pcb.ratsnest.filter((one) => one.net === "net:R1.pin1" || one.from.startsWith("R1#") || one.to.startsWith("R1#"))
    expect(line).toBeDefined()
    const done: RouteEvent = {
      file: MAIN,
      state: "done",
      routed: 0,
      total: 2,
      passes: 1,
      cleanupCapped: false,
      unrouted: [
        { net: line!.net, from: line!.to, to: line!.from, reason: "could not route R2.pin1 to R1.pin1: no way past U9", blockers: ["U9"] },
        { net: "net.X", from: "R9#1", to: "R8#1", reason: "routed by hand since", blockers: [] },
      ],
    }
    const rows = checkRows(built, done)
    const unrouted = rows.filter((row) => row.id.startsWith("route:"))
    expect(unrouted).toEqual([
      {
        id: `route:${line!.to}:${line!.from}`,
        severity: "warning",
        code: "unrouted",
        message: "could not route R2.pin1 to R1.pin1: no way past U9",
        items: [line!.to, line!.from, "U9"],
        view: "pcb",
        at: { x: (line!.a.x + line!.b.x) / 2, y: (line!.a.y + line!.b.y) / 2 },
        part: line!.to.split("#")[0],
      },
    ])
    expect(checkRows(built, { file: MAIN, state: "running", pass: 1, done: 0, total: 2 })).toEqual(checkRows(built))
  })
})
