import { expect, test } from "vitest"
import type { PcbTrack } from "../../src/engine/copper.js"
import type { Board, CopperPour, Hole, Keepout, Point } from "../../src/engine/model.js"
import type { WorldPad } from "../../src/engine/pcb.js"
import { difference, intersection, pathArea, regions, toPath, type Paths } from "../../src/engine/pour/clip.js"
import { fillPours, type PourFill, type PourInputs } from "../../src/engine/pour/fill.js"
import { shapeOutline } from "../../src/engine/pour/shapes.js"
import { DEFAULT_CLASS } from "../../src/engine/rules/profiles.js"
import { loadRules } from "../../src/engine/rules/load.js"

const SOURCE = { file: "main.circuit.tsx", line: 1, column: 1, offset: 0 }
const RULES = loadRules({}).rules
const HALF = 10
const EDGE = RULES.fabrication.boardEdgeClearance
const CLEARANCE = DEFAULT_CLASS.clearance

const rectangle = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
]

function pour(extra: Partial<CopperPour> = {}): CopperPour {
  return { id: "copperpour:1", net: "net.GND", layer: "top", priority: 0, minWidth: 0.25, thermal: "relief", thermalWidth: 0.3, thermalGap: 0.25, source: SOURCE, ...extra }
}

function pad(id: string, net: string | undefined, x: number, y: number, extra: Partial<WorldPad> = {}): WorldPad {
  const base = { id, component: id.split("#")[0] ?? id, number: "1", shape: "circle" as const, x, y, width: 1.6, height: 1.6, rotation: 0 }
  return { ...base, layers: "through", drill: { width: 0.8, height: 0.8 }, ...(net === undefined ? {} : { net }), ...extra }
}

function track(id: string, net: string, points: Point[], width = 0.2): PcbTrack {
  return { id, net, layer: "top", width, points, locked: false, by: "human", pads: [] }
}

interface Scene {
  pours?: CopperPour[]
  pads?: WorldPad[]
  tracks?: PcbTrack[]
  keepouts?: Keepout[]
  holes?: Hole[]
}

function inputs(scene: Scene): PourInputs {
  const board: Board = {
    outline: rectangle(-HALF, -HALF, HALF, HALF),
    layers: 2,
    thickness: 1.6,
    keepouts: scene.keepouts ?? [],
    pours: scene.pours ?? [pour()],
    ...(scene.holes ? { holes: scene.holes } : {}),
  }
  return { board, pads: scene.pads ?? [], tracks: scene.tracks ?? [], vias: [], rules: RULES, classOf: () => DEFAULT_CLASS.name }
}

const fill = (scene: Scene): PourFill => fillPours(inputs(scene))[0] as PourFill
const paths = (filled: PourFill): Paths => filled.polygons.flatMap((polygon) => [toPath(polygon.outer), ...polygon.holes.map(toPath)])
/** The area in mm² of the fill inside the outline. */
const areaIn = (filled: PourFill, outline: Point[]) => intersection(paths(filled), [toPath(outline)]).reduce((sum, p) => sum + pathArea(p), 0) / 1e6
const circle = (centre: Point, radius: number) => shapeOutline({ core: [centre], radius })

/** The shortest distance from a point to the fill's edges. */
function distanceToEdges(filled: PourFill, p: Point): number {
  const rings = filled.polygons.flatMap((polygon) => [polygon.outer, ...polygon.holes])
  return Math.min(
    ...rings.flatMap((ring) =>
      ring.map((a, i) => {
        const b = ring[(i + 1) % ring.length] as Point
        const [dx, dy] = [b.x - a.x, b.y - a.y]
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
        return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
      }),
    ),
  )
}

test("a whole-board pour on an empty board is the outline shrunk by the board-edge clearance, corners rounded by the open", () => {
  const filled = fill({})
  const inner = HALF - EDGE
  expect(filled).toMatchObject({ id: "copperpour:1", net: "net.GND", layer: "top", polygons: [{ holes: [] }] })
  const outer = filled.polygons[0]?.outer ?? []
  const xs = outer.map((p) => p.x)
  const ys = outer.map((p) => p.y)
  expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([-inner, inner, -inner, inner])
  // Four corners of radius minWidth / 2 = 0.125 lose (1 − π/4) × 0.125² each.
  const rounded = (2 * inner) ** 2 - 4 * (1 - Math.PI / 4) * 0.125 ** 2
  expect(filled.area).toBeCloseTo(rounded, 2)
  expect(filled.area).toBeLessThanOrEqual(rounded)
})

test("a pad of another net leaves a clearance gap round it", () => {
  const filled = fill({ pads: [pad("U1#1", "net.VCC", 0, 0, { width: 1, height: 1 })] })
  expect(filled.polygons).toHaveLength(1)
  expect(filled.polygons[0]?.holes).toHaveLength(1)
  const gap = distanceToEdges(filled, { x: 0, y: 0 }) - 0.5
  expect(gap).toBeGreaterThanOrEqual(CLEARANCE)
  expect(gap).toBeLessThan(CLEARANCE + 0.01)
  expect(areaIn(filled, circle({ x: 0, y: 0 }, 0.5 + CLEARANCE))).toBe(0)
})

test("a pad without a net is kept clear of too, and a larger pour clearance wins over the class's", () => {
  const filled = fill({ pours: [pour({ clearance: 0.5 })], pads: [pad("U1#1", undefined, 0, 0, { width: 1, height: 1 })] })
  const gap = distanceToEdges(filled, { x: 0, y: 0 }) - 0.5
  expect(gap).toBeGreaterThanOrEqual(0.5)
  expect(gap).toBeLessThan(0.51)
})

test("a same-net through pad gets four spokes of the thermal width across the thermal gap", () => {
  const filled = fill({ pads: [pad("J1#1", "net.GND", 0, 0)] })
  const ring = difference([toPath(circle({ x: 0, y: 0 }, 0.8 + 0.25))], [toPath(circle({ x: 0, y: 0 }, 0.8))])
  const spokes = regions(intersection(paths(filled), ring))
  expect(spokes).toHaveLength(4)
  for (const spoke of spokes) {
    const area = pathArea(spoke.outer) / 1e6
    expect(area).toBeGreaterThan(0.3 * 0.25 * 0.95)
    expect(area).toBeLessThan(0.3 * 0.25 * 1.1)
  }
  const centres = spokes.map((spoke) => {
    const n = spoke.outer.length
    return { x: Math.round(spoke.outer.reduce((s, p) => s + p.X, 0) / n / 100) + 0, y: Math.round(spoke.outer.reduce((s, p) => s + p.Y, 0) / n / 100) + 0 }
  })
  expect(centres).toEqual(expect.arrayContaining([{ x: 9, y: 0 }, { x: -9, y: 0 }, { x: 0, y: 9 }, { x: 0, y: -9 }]))
  const besideSpokes = intersection(ring, [toPath(rectangle(0.2, 0.2, 2, 2))])
  expect(intersection(paths(filled), besideSpokes)).toEqual([])
})

test("spokes follow a turned pad's own axes", () => {
  const filled = fill({ pads: [pad("U1#1", "net.GND", 0, 0, { shape: "rect", width: 1, height: 0.6, rotation: 45, layers: "top" })] })
  const along = Math.SQRT1_2 * (0.5 + 0.12)
  expect(areaIn(filled, circle({ x: along, y: along }, 0.05))).toBeGreaterThan(0.007)
  expect(areaIn(filled, circle({ x: 0.62, y: 0 }, 0.05))).toBe(0)
})

test("a solid pour joins its pads fully", () => {
  const filled = fill({ pours: [pour({ thermal: "solid" })], pads: [pad("J1#1", "net.GND", 0, 0)] })
  const around = circle({ x: 0, y: 0 }, 0.8 + 0.25)
  expect(areaIn(filled, around)).toBeCloseTo(Math.abs(pathArea(toPath(around))) / 1e6, 3)
  expect(filled.polygons[0]?.holes).toEqual([])
})

test("a keepout on the layer and a hole are cut out; a keepout on the other side is not", () => {
  const keepout = (layers: Keepout["layers"], x: number): Keepout => ({ id: `keepout:${x}`, outline: rectangle(x, 4, x + 2, 6), layers, source: SOURCE })
  const hole: Hole = { id: "hole:1", x: -5, y: -5, diameter: 2, source: SOURCE }
  const filled = fill({ keepouts: [keepout("all", 4), keepout("top", 0), keepout("bottom", -4)], holes: [hole] })
  expect(areaIn(filled, rectangle(4, 4, 6, 6))).toBe(0)
  expect(areaIn(filled, rectangle(0, 4, 2, 6))).toBe(0)
  expect(areaIn(filled, rectangle(-4, 4, -2, 6))).toBeCloseTo(4, 6)
  expect(areaIn(filled, circle({ x: -5, y: -5 }, 1 + EDGE))).toBe(0)
  expect(distanceToEdges(filled, { x: -5, y: -5 })).toBeLessThan(1 + EDGE + 0.01)
})

test("an island without copper of the pour's net is removed", () => {
  const wall = track("t1", "net.VCC", [{ x: 0, y: -11 }, { x: 0, y: 11 }], 1)
  const filled = fill({ pads: [pad("J1#1", "net.GND", -5, 0)], tracks: [wall] })
  expect(filled.polygons).toHaveLength(1)
  expect(Math.max(...(filled.polygons[0]?.outer.map((p) => p.x) ?? []))).toBeLessThan(0)
  const joined = fill({ pads: [pad("J1#1", "net.GND", -5, 0)], tracks: [wall, track("t2", "net.GND", [{ x: 5, y: 0 }, { x: 6, y: 0 }])] })
  expect(joined.polygons).toHaveLength(2)
})

test("copper narrower than minWidth is removed", () => {
  const top = HALF - EDGE
  const y = top - 0.15 - CLEARANCE - 0.1 - 0.003
  const wall = track("t1", "net.VCC", [{ x: -11, y }, { x: 11, y }])
  const highest = (filled: PourFill) => Math.max(...filled.polygons.flatMap((polygon) => polygon.outer.map((p) => p.y)))
  expect(highest(fill({ tracks: [wall] }))).toBeLessThan(y)
  expect(highest(fill({ tracks: [wall], pours: [pour({ minWidth: 0.1 })] }))).toBeCloseTo(top, 6)
})

test("where two pours overlap the higher priority keeps the copper, the other keeps its clearance", () => {
  const left = pour({ id: "copperpour:2", net: "net.VCC", outline: rectangle(-HALF, -HALF, 0, HALF), priority: 1 })
  const [ground, power] = fillPours(inputs({ pours: [pour(), left] })) as [PourFill, PourFill]
  expect(power.area).toBeCloseTo((HALF - EDGE) * 2 * (HALF - EDGE), 1)
  expect(Math.min(...ground.polygons.flatMap((polygon) => polygon.outer.map((p) => p.x)))).toBeGreaterThanOrEqual(CLEARANCE)
  const [groundFirst, powerSecond] = fillPours(inputs({ pours: [pour({ priority: 2 }), left] })) as [PourFill, PourFill]
  expect(groundFirst.area).toBeCloseTo(384.16, 1)
  expect(powerSecond.polygons).toEqual([])
})

test("equal priorities go in source order, and the result keeps the board's pour order", () => {
  const left = pour({ id: "copperpour:2", net: "net.VCC", outline: rectangle(-HALF, -HALF, 0, HALF) })
  const result = fillPours(inputs({ pours: [pour(), left] }))
  expect(result.map((filled) => [filled.id, filled.polygons.length])).toEqual([
    ["copperpour:1", 1],
    ["copperpour:2", 0],
  ])
})

test("the fill is the same every time, outlines counter-clockwise from their lowest-left point and holes clockwise", () => {
  const scene: Scene = {
    pads: [pad("J1#1", "net.GND", -3, 0), pad("J1#2", "net.VCC", 3, 0), pad("U1#1", "net.GND", 0, 3, { shape: "rect", width: 1, height: 0.5, layers: "top" })],
    tracks: [track("t1", "net.VCC", [{ x: 3, y: 0 }, { x: 3, y: -6 }])],
  }
  const first = fillPours(inputs(scene))
  expect(fillPours(inputs(scene))).toEqual(first)
  for (const polygon of first[0]?.polygons ?? []) {
    expect(pathArea(toPath(polygon.outer))).toBeGreaterThan(0)
    const lowest = [...polygon.outer].sort((a, b) => a.x - b.x || a.y - b.y)[0]
    expect(polygon.outer[0]).toEqual(lowest)
    for (const hole of polygon.holes) expect(pathArea(toPath(hole))).toBeLessThan(0)
  }
})

test("a keepout drawn clockwise over another net's pad still keeps all copper out of both", () => {
  const keepout: Keepout = { id: "keepout:1", outline: [...rectangle(-3, -3, 0.2, 3)].reverse(), layers: "all", source: SOURCE }
  const filled = fill({ keepouts: [keepout], pads: [pad("U1#1", "net.X", 0, 0, { width: 1, height: 1 })] })
  expect(areaIn(filled, rectangle(-3, -3, 0.2, 3))).toBe(0)
  expect(areaIn(filled, circle({ x: 0, y: 0 }, 0.5 + CLEARANCE))).toBe(0)
})

test("a piece crossed by a track of the pour's net counts as joined though no track point is inside it", () => {
  const crossing = track("t1", "net.GND", [{ x: -8, y: 0 }, { x: 8, y: 0 }])
  const filled = fill({ pours: [pour({ outline: rectangle(-3, -3, 3, 3) })], tracks: [crossing] })
  expect(filled.area).toBeCloseTo(36, 1)
})

test("a pad whose surroundings were opened away gets no spokes and no copper", () => {
  const ring = Array.from({ length: 8 }, (_, i) => {
    const angle = (i * Math.PI) / 4
    return pad(`U${i + 2}#1`, "net.X", 2.2 * Math.cos(angle), 2.2 * Math.sin(angle))
  })
  const filled = fill({ pads: [pad("J1#1", "net.GND", 0, 0), ...ring] })
  expect(areaIn(filled, circle({ x: 0, y: 0 }, 1.15))).toBe(0)
})

test("a spoke keeps out of a neighbouring same-net pad's relief gap", () => {
  const smd = (id: string, x: number, y: number) => pad(id, "net.GND", x, y, { shape: "rect", width: 0.4, height: 0.4, layers: "top" })
  const filled = fill({ pads: [smd("U1#1", 0, 0), smd("U1#2", 0.55, 0.5)] })
  expect(areaIn(filled, rectangle(0.3, 0.1, 0.38, 0.15))).toBe(0)
  expect(areaIn(filled, circle({ x: 0.33, y: 0 }, 0.05))).toBeGreaterThan(0.007)
})

test("the open grows back round, so a sharp tip narrower than minWidth does not survive", () => {
  // The wedge is 0.212 mm wide at x = 0.53: a mitred grow keeps it that wide, a round one leaves a rounded tip.
  const wedge = pour({ outline: [{ x: 0, y: 0 }, { x: 3, y: -0.6 }, { x: 3, y: 0.6 }] })
  const filled = fill({ pours: [wedge] })
  expect(filled.area).toBeGreaterThan(1.5)
  const width = areaIn(filled, rectangle(0.53, -1, 0.531, 1)) / 0.001
  expect(width).toBeLessThan(0.15)
})
