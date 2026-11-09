import { describe, expect, test } from "vitest"
import type { RouteNet } from "../studio/src/pcb/track-rules.js"
import {
  addRouteCorner,
  finishRoute,
  nextRouteMode,
  removeRouteCorner,
  routeDrawing,
  startRoute,
  switchRouteLayer,
  viaPlacement,
  type Route,
  type RouteTarget,
  type StartContext,
} from "../studio/src/pcb/track-tool.js"

const p = (x: number, y: number) => ({ x, y })
const NETS: Record<string, RouteNet> = {
  "net.VBUS": { id: "net.VBUS", name: "VBUS", width: 0.5, via: { drill: 0.3, diameter: 0.6 } },
  "net.GND": { id: "net.GND", name: "GND", width: 0.25, via: { drill: 0.3, diameter: 0.6 } },
}
const context = (over: Partial<StartContext> = {}): StartContext => ({ activeLayer: "top", locked: new Set(), netOf: (id) => NETS[id], ...over })
const pad = (label: string, at: { x: number; y: number }, net: string | undefined, layer: "top" | "bottom" | "through" = "top"): RouteTarget => ({
  kind: "pad",
  id: `${label.split(".")[0]}#1`,
  label,
  part: label.split(".")[0] as string,
  at,
  ...(net ? { net, netName: NETS[net]?.name ?? net } : {}),
  layer,
})

const started = (target: RouteTarget, over: Partial<StartContext> = {}): Route => {
  const result = startRoute(target, context(over))
  if (!("route" in result)) throw new Error(result.message)
  return result.route
}

describe("starting a track", () => {
  test("a pad starts it on its net, with the net's width, on the active layer for a through pad", () => {
    const route = started(pad("J1.1", p(0, 0), "net.VBUS", "through"), { activeLayer: "bottom" })
    expect(route).toMatchObject({ net: NETS["net.VBUS"], layer: "bottom", mode: "45", corners: [] })
    expect(route.start).toMatchObject({ label: "J1.1", at: p(0, 0), through: true })
  })

  test("a surface pad starts it on the pad's own layer", () => {
    expect(started(pad("U1.1", p(0, 0), "net.GND", "bottom")).layer).toBe("bottom")
  })

  test("a pad of a locked part is refused, as the core refuses it", () => {
    expect(startRoute(pad("U1.1", p(0, 0), "net.GND"), context({ locked: new Set(["U1"]) }))).toEqual({ message: "U1 is locked: a track may not start on its pads. Unlock it first." })
  })

  test("a pad on no net, and anything but a pad, are refused", () => {
    expect(startRoute(pad("R1.2", p(0, 0), undefined), context())).toEqual({ message: "R1.2 is on no net; connect it in the schematic first" })
    expect(startRoute({ kind: "via", id: "v0001", at: p(0, 0), net: "net.GND", netName: "GND" }, context())).toEqual({ message: "Start a track on a pad" })
  })
})

describe("corners, Space, V and Backspace", () => {
  const route = () => started(pad("U1.1", p(0, 0), "net.VBUS"))

  test("a click adds a corner in the current mode and layer; a click on the last point adds none", () => {
    const one = addRouteCorner(route(), p(10, 4))
    expect(one.corners).toEqual([{ at: p(10, 4), mode: "45", layer: "top" }])
    expect(addRouteCorner(one, p(10, 4))).toBe(one)
  })

  test("Space steps the mode for the leg to the pointer; corners keep theirs", () => {
    const one = nextRouteMode(addRouteCorner(route(), p(10, 4)))
    expect(one.mode).toBe("45r")
    expect(one.corners[0]?.mode).toBe("45")
  })

  test("V changes the layer at the last corner, which then holds a via; V again takes it back", () => {
    const one = addRouteCorner(route(), p(10, 4))
    const flipped = switchRouteLayer(one)
    if ("message" in flipped) throw new Error(flipped.message)
    expect(flipped.layer).toBe("bottom")
    expect(routeDrawing(flipped, p(20, 4)).vias).toEqual([{ at: p(10, 4), drill: 0.3, diameter: 0.6 }])
    const back = switchRouteLayer(flipped)
    expect("message" in back ? back : routeDrawing(back, p(20, 4)).vias).toEqual([])
  })

  test("V before any corner is refused on a surface pad, and only changes the layer on a through pad", () => {
    expect(switchRouteLayer(route())).toEqual({ message: "U1.1 is on the Top Layer only; click a corner before changing layer" })
    const through = switchRouteLayer(started(pad("J1.1", p(0, 0), "net.VBUS", "through")))
    if ("message" in through) throw new Error(through.message)
    expect(through.layer).toBe("bottom")
    expect(routeDrawing(through, p(5, 0))).toEqual({ tracks: [{ layer: "bottom", width: 0.5, points: [p(0, 0), p(5, 0)] }], vias: [] })
  })

  test("Backspace removes the last corner and the via placed there", () => {
    const one = switchRouteLayer(addRouteCorner(route(), p(10, 4)))
    if ("message" in one) throw new Error(one.message)
    const back = removeRouteCorner(one)
    expect(back.corners).toEqual([])
    expect(back.layer).toBe("top")
    expect(removeRouteCorner(back)).toBe(back)
  })
})

describe("routeDrawing", () => {
  test("splits the route into a track per layer with a via between, the leg to the pointer included", () => {
    let route = addRouteCorner(started(pad("U1.1", p(0, 0), "net.VBUS")), p(10, 4))
    const flipped = switchRouteLayer(route)
    if ("message" in flipped) throw new Error(flipped.message)
    route = nextRouteMode(nextRouteMode(flipped))
    expect(routeDrawing(route, p(20, 10))).toEqual({
      tracks: [
        { layer: "top", width: 0.5, points: [p(0, 0), p(6, 0), p(10, 4)] },
        { layer: "bottom", width: 0.5, points: [p(10, 4), p(20, 4), p(20, 10)] },
      ],
      vias: [{ at: p(10, 4), drill: 0.3, diameter: 0.6 }],
    })
  })
})

describe("finishing a track", () => {
  const twoLayer = (): Route => {
    const flipped = switchRouteLayer(addRouteCorner(started(pad("U1.1", p(0, 0), "net.VBUS")), p(10, 0)))
    if ("message" in flipped) throw new Error(flipped.message)
    return flipped
  }

  test("a pad of the same net ends it: the tracks and the via in one list of edits, in path order", () => {
    const end = finishRoute(twoLayer(), pad("C1.1", p(20, 0), "net.VBUS", "bottom"))
    expect(end).toEqual({
      edits: [
        { kind: "addTrack", net: "VBUS", layer: "top", width: 0.5, points: [p(0, 0), p(10, 0)] },
        { kind: "addVia", net: "VBUS", at: p(10, 0), drill: 0.3, diameter: 0.6, layers: ["top", "bottom"] },
        { kind: "addTrack", net: "VBUS", layer: "bottom", width: 0.5, points: [p(10, 0), p(20, 0)] },
      ],
      summary: "Route VBUS from U1.1 to C1.1",
      drawing: routeDrawing(twoLayer(), p(20, 0)),
    })
  })

  test("a pad of another net is refused with both net names", () => {
    expect(finishRoute(twoLayer(), pad("C2.1", p(20, 0), "net.GND", "through"))).toEqual({ message: "C2.1 is on GND, but the track is on VBUS" })
    expect(finishRoute(twoLayer(), pad("C2.2", p(20, 0), undefined, "through"))).toEqual({ message: "C2.2 is on no net, but the track is on VBUS" })
  })

  test("a surface pad of the net on the other layer asks for V first", () => {
    expect(finishRoute(twoLayer(), pad("C1.1", p(20, 0), "net.VBUS", "top"))).toEqual({ message: "C1.1 is on the Top Layer; press V to change layer first" })
  })

  test("a track or a via of the same net ends it at the meeting point; of another net it is refused", () => {
    const onTrack = finishRoute(twoLayer(), { kind: "track", id: "t0007", at: p(20, 3), net: "net.VBUS", netName: "VBUS", layer: "bottom" })
    expect(onTrack).toMatchObject({ summary: "Route VBUS from U1.1 to track t0007" })
    expect(onTrack && "edits" in onTrack ? onTrack.edits.at(-1) : undefined).toEqual({ kind: "addTrack", net: "VBUS", layer: "bottom", width: 0.5, points: [p(10, 0), p(17, 0), p(20, 3)] })
    expect(finishRoute(twoLayer(), { kind: "via", id: "v0002", at: p(20, 0), net: "net.VBUS", netName: "VBUS" })).toMatchObject({ summary: "Route VBUS from U1.1 to via v0002" })
    expect(finishRoute(twoLayer(), { kind: "via", id: "v0003", at: p(20, 0), net: "net.GND", netName: "GND" })).toEqual({ message: "Via v0003 is on GND, but the track is on VBUS" })
  })

  test("a click back on the start pad with no corner ends nothing", () => {
    const route = started(pad("U1.1", p(0, 0), "net.VBUS"))
    expect(finishRoute(route, pad("U1.1", p(0, 0), "net.VBUS"))).toBeUndefined()
  })
})

describe("Route → Via", () => {
  test("a via on a pad or track takes its net and the net's via size", () => {
    const placed = viaPlacement(p(3, 4), NETS["net.GND"])
    expect(placed).toEqual({
      edits: [{ kind: "addVia", net: "GND", at: p(3, 4), drill: 0.3, diameter: 0.6, layers: ["top", "bottom"] }],
      summary: "Add via on GND at (3, 4)",
      drawing: { tracks: [], vias: [{ at: p(3, 4), drill: 0.3, diameter: 0.6 }] },
    })
  })

  test("a via on nothing has no net and the default size", () => {
    expect(viaPlacement(p(1, 1), undefined, { drill: 0.3, diameter: 0.6 })).toMatchObject({
      edits: [{ kind: "addVia", at: p(1, 1), drill: 0.3, diameter: 0.6, layers: ["top", "bottom"] }],
      summary: "Add via at (1, 1)",
    })
  })
})
