import { describe, expect, test } from "vitest"
import type { CopperLayer } from "../../src/core/layout-file.js"
import { gerberFiles, gerberLayers } from "../../src/engine/fab/layers.js"
import type { PcbLayout, PcbTrack, PcbVia, PlacedFootprint, WorldPad } from "../../src/engine/pcb.js"
import { loadRules } from "../../src/engine/rules/load.js"
import { PROFILES } from "../../src/engine/rules/profiles.js"
import type { FabricationProfile } from "../../src/engine/rules/schema.js"
import { readGerber, type ReadGerber } from "../helpers/gerber-read.js"

const PROFILE = PROFILES["jlcpcb-2layer"] as FabricationProfile
const CREATED = new Date(Date.UTC(2026, 10, 10))
const OUTLINE = [
  { x: -10, y: -5 },
  { x: 10, y: -5 },
  { x: 10, y: 5 },
  { x: -10, y: 5 },
]

const pad = (number: string, fields: Partial<WorldPad>): WorldPad => ({
  number,
  shape: "rect",
  x: 0,
  y: 0,
  width: 1,
  height: 0.6,
  rotation: 0,
  layers: "top",
  id: `P1#${number}`,
  component: "P1",
  ...fields,
})

const part = (pads: WorldPad[], fields: Partial<PlacedFootprint> = {}): PlacedFootprint => ({
  component: "P1",
  x: 0,
  y: 0,
  rotation: 0,
  side: "top",
  autoPlaced: false,
  pads,
  courtyard: [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
  ],
  silkscreen: [],
  fabrication: [],
  ...fields,
})

const track = (layer: CopperLayer, points: { x: number; y: number }[], width = 0.25): PcbTrack => ({ id: "t0001", layer, width, points, locked: false, by: "human", pads: [] })
const via = (x: number, y: number): PcbVia => ({ id: "v0001", at: { x, y }, drill: 0.3, diameter: 0.6, layers: ["top", "bottom"], locked: false, by: "human" })

const board = (fields: Partial<PcbLayout>, layers: 2 | 4 = 2): PcbLayout => ({
  board: { outline: OUTLINE, layers, thickness: 1.6, keepouts: [] },
  parts: [],
  tracks: [],
  vias: [],
  ratsnest: [],
  ...fields,
})

function files(pcb: PcbLayout, profile: FabricationProfile = PROFILE): Map<string, ReadGerber> {
  return new Map(gerberFiles(pcb, profile, "b", CREATED).map(({ file, text }) => [file, readGerber(text)]))
}
const fileOf = (read: Map<string, ReadGerber>, name: string): ReadGerber => {
  const found = read.get(name)
  if (!found) throw new Error(`no ${name}`)
  return found
}

describe("the Gerber layers of a board", () => {
  test("a 2-layer board has nine files, each with its X2 file function; a 4-layer board adds two inner copper layers", () => {
    const two = gerberFiles(board({}), PROFILE, "b", CREATED)
    expect(two.map((f) => f.file)).toEqual(["b-F_Cu.gtl", "b-B_Cu.gbl", "b-F_Mask.gts", "b-B_Mask.gbs", "b-F_Paste.gtp", "b-B_Paste.gbp", "b-F_Silkscreen.gto", "b-B_Silkscreen.gbo", "b-Edge_Cuts.gm1"])
    const functions = two.map((f) => readGerber(f.text).fileAttributes.find((a) => a.startsWith(".FileFunction")))
    expect(functions).toEqual([
      ".FileFunction,Copper,L1,Top",
      ".FileFunction,Copper,L2,Bot",
      ".FileFunction,Soldermask,Top",
      ".FileFunction,Soldermask,Bot",
      ".FileFunction,Paste,Top",
      ".FileFunction,Paste,Bot",
      ".FileFunction,Legend,Top",
      ".FileFunction,Legend,Bot",
      ".FileFunction,Profile,NP",
    ])
    for (const { text } of two) {
      const attributes = readGerber(text).fileAttributes.map((a) => a.split(",")[0])
      expect(attributes).toEqual([".GenerationSoftware", ".CreationDate", ".Part", ".FileFunction", ".FilePolarity"])
    }
    const four = gerberLayers(board({}, 4), PROFILE)
    expect(four.slice(0, 4).map((l) => [l.name, l.layer.fileFunction])).toEqual([
      ["F_Cu", "Copper,L1,Top"],
      ["In1_Cu", "Copper,L2,Inr"],
      ["In2_Cu", "Copper,L3,Inr"],
      ["B_Cu", "Copper,L4,Bot"],
    ])
  })

  test("a one-pad board round-trips: the pad's aperture and its flash position on the top copper", () => {
    const read = files(board({ parts: [part([pad("1", { x: 2.5, y: -1.5, width: 1.2, height: 0.7 })])] }))
    const top = fileOf(read, "b-F_Cu.gtl")
    expect(top.flashes).toHaveLength(1)
    expect(top.flashes[0]?.at).toEqual({ x: 2.5, y: -1.5 })
    expect(top.flashes[0]?.aperture.shape).toEqual({ type: "rectangle", xSize: 1.2, ySize: 0.7 })
    expect(top.flashes[0]?.aperture.fn).toBe("SMDPad,CuDef")
    expect(fileOf(read, "b-B_Cu.gbl").flashes).toEqual([])
  })

  test("a pad turned a quarter swaps its sizes; a pad at another angle is a region of its corners", () => {
    const read = files(board({ parts: [part([pad("1", { rotation: 90 }), pad("2", { x: 3, rotation: 45, width: 2, height: 2 })])] }))
    const top = fileOf(read, "b-F_Cu.gtl")
    expect(top.flashes[0]?.aperture.shape).toEqual({ type: "rectangle", xSize: 0.6, ySize: 1 })
    expect(top.regions).toHaveLength(1)
    const corners = top.regions[0]?.points.map((p) => ({ x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 }))
    expect(corners).toEqual([
      { x: 3, y: -1.414214 },
      { x: 4.414214, y: 0 },
      { x: 3, y: 1.414214 },
      { x: 1.585786, y: 0 },
      { x: 3, y: -1.414214 },
    ])
    expect(top.regions[0]?.fn).toBe("SMDPad,CuDef")
  })

  test("a track with a 45 degree corner is one stroke through its points, with a round aperture of its width", () => {
    const points = [
      { x: -5, y: 0 },
      { x: 0, y: 0 },
      { x: 2, y: 2 },
    ]
    const top = fileOf(files(board({ tracks: [track("top", points, 0.3)] })), "b-F_Cu.gtl")
    expect(top.strokes).toEqual([{ points, aperture: expect.objectContaining({ shape: { type: "circle", diameter: 0.3 }, fn: "Conductor" }) }])
  })

  test("a via is flashed on both copper layers and nowhere in the mask (tented)", () => {
    const read = files(board({ vias: [via(1, 2)] }))
    for (const name of ["b-F_Cu.gtl", "b-B_Cu.gbl"]) {
      expect(fileOf(read, name).flashes.map((f) => [f.at, f.aperture.shape, f.aperture.fn])).toEqual([[{ x: 1, y: 2 }, { type: "circle", diameter: 0.6 }, "ViaPad"]])
    }
    expect(fileOf(read, "b-F_Mask.gts").flashes).toEqual([])
    expect(fileOf(read, "b-B_Mask.gbs").flashes).toEqual([])
  })

  test("copper on a layer the board lacks is left out", () => {
    const inner = { ...track("inner1", [{ x: 0, y: 0 }, { x: 1, y: 0 }]), missingLayer: "inner1" as const }
    expect(gerberLayers(board({ tracks: [inner] }), PROFILE).flatMap((l) => l.layer.objects)).toHaveLength(1)
  })

  test("a rounded-rectangle pad is a RoundRect macro flash", () => {
    const top = fileOf(files(board({ parts: [part([pad("1", { shape: "roundrect", width: 1.2, height: 0.8, cornerRadius: 0.2, rotation: 90 })])] })), "b-F_Cu.gtl")
    expect(top.macros).toEqual(["RoundRect"])
    expect(top.flashes[0]?.aperture.shape).toEqual({ type: "macroShape", name: "RoundRect", variableValues: [0.2, -0.2, -0.4, 0.2, -0.4, 0.2, 0.4, -0.2, 0.4] })
    const turned = fileOf(files(board({ parts: [part([pad("1", { shape: "oval", width: 2, height: 1, rotation: 30 })])] })), "b-F_Cu.gtl")
    expect(turned.flashes[0]?.aperture.shape).toEqual({ type: "macroShape", name: "RoundRect", variableValues: [0.5, -0.433013, -0.25, 0.433013, 0.25, 0.433013, 0.25, -0.433013, -0.25] })
  })

  test("the mask opens every pad on its side grown by the expansion: 0.05 mm by default, else the profile's", () => {
    const pads = [pad("1", { shape: "roundrect", width: 1, height: 0.5, cornerRadius: 0.1 }), pad("2", { x: 3, shape: "circle", width: 1.7, height: 1.7, layers: "through", drill: { width: 1, height: 1 } })]
    const read = files(board({ parts: [part(pads)] }))
    const top = fileOf(read, "b-F_Mask.gts")
    expect(top.fileAttributes).toContain(".FilePolarity,Negative")
    expect(top.flashes.map((f) => f.aperture.shape)).toEqual([
      { type: "macroShape", name: "RoundRect", variableValues: [0.15, -0.4, -0.15, 0.4, -0.15, 0.4, 0.15, -0.4, 0.15] },
      { type: "circle", diameter: 1.8 },
    ])
    expect(fileOf(read, "b-B_Mask.gbs").flashes.map((f) => f.aperture.shape)).toEqual([{ type: "circle", diameter: 1.8 }])
    expect(top.flashes.map((f) => f.aperture.fn)).toEqual(["SMDPad,CuDef", "ComponentPad"])
    const turnedRect = fileOf(files(board({ parts: [part([pad("1", { rotation: 30 })])] })), "b-F_Mask.gts")
    expect(turnedRect.regions[0]?.fn).toBe("SMDPad,CuDef")
    const wider = loadRules({ "rules.yaml": "fabrication:\n  maskExpansion: 0.1mm\n" })
    expect(wider.diagnostics).toEqual([])
    const grown = fileOf(files(board({ parts: [part(pads)] }), wider.rules.fabrication), "b-F_Mask.gts")
    expect(grown.flashes[1]?.aperture.shape).toEqual({ type: "circle", diameter: 1.9 })
    const none = loadRules({ "rules.yaml": "fabrication:\n  maskExpansion: 0\n" })
    expect(none.diagnostics).toEqual([])
    expect(fileOf(files(board({ parts: [part(pads)] }), none.rules.fabrication), "b-F_Mask.gts").flashes[1]?.aperture.shape).toEqual({ type: "circle", diameter: 1.7 })
    expect(loadRules({ "rules.yaml": "fabrication:\n  maskExpansion: -1\n" }).diagnostics[0]?.message).toMatch(/fabrication\.maskExpansion/)
  })

  test("paste covers SMD pads only, shrunk by the paste reduction (none by default), on their own side", () => {
    const pads = [pad("1", { width: 1, height: 0.5 }), pad("2", { x: 3, shape: "circle", width: 1.7, height: 1.7, layers: "through", drill: { width: 1, height: 1 } }), pad("3", { x: -3, layers: "bottom" })]
    const read = files(board({ parts: [part(pads)] }))
    expect(fileOf(read, "b-F_Paste.gtp").flashes.map((f) => [f.at, f.aperture.shape])).toEqual([[{ x: 0, y: 0 }, { type: "rectangle", xSize: 1, ySize: 0.5 }]])
    expect(fileOf(read, "b-B_Paste.gbp").flashes.map((f) => f.at)).toEqual([{ x: -3, y: 0 }])
    expect(fileOf(read, "b-F_Paste.gtp").flashes[0]?.aperture.fn).toBe("SMDPad,CuDef")
    const reduced = loadRules({ "rules.yaml": "fabrication:\n  pasteReduction: 0.05\n" }).rules.fabrication
    expect(fileOf(files(board({ parts: [part(pads)] }), reduced), "b-F_Paste.gtp").flashes[0]?.aperture.shape).toEqual({ type: "rectangle", xSize: 0.9, ySize: 0.4 })
  })

  test("the outline is one closed path of 0.1 mm around the board", () => {
    const edge = fileOf(files(board({})), "b-Edge_Cuts.gm1")
    expect(edge.strokes).toHaveLength(1)
    expect(edge.strokes[0]?.points).toEqual([...OUTLINE, OUTLINE[0]])
    expect(edge.strokes[0]?.aperture.shape).toEqual({ type: "circle", diameter: 0.1 })
    expect(edge.strokes[0]?.aperture.fn).toBe("Profile")
    const length = OUTLINE.reduce((sum, p, i) => {
      const next = OUTLINE[(i + 1) % OUTLINE.length] ?? p
      return sum + Math.hypot(next.x - p.x, next.y - p.y)
    }, 0)
    expect(length).toBe(60)
  })

  test("the silkscreen holds each part's outline and designator on its side, the bottom one mirrored", () => {
    const silk = [
      [
        { x: -1, y: 1 },
        { x: 1, y: 1 },
      ],
    ]
    const top = part([], { silkscreen: silk })
    const bottom = part([], { component: "U2", side: "bottom", x: 5, silkscreen: [] })
    const read = files(board({ parts: [top, bottom] }))
    const front = fileOf(read, "b-F_Silkscreen.gto")
    expect(front.strokes[0]?.points).toEqual(silk[0])
    expect(front.strokes.length).toBeGreaterThan(2)
    expect(front.strokes.every((s) => (s.aperture.shape as { diameter?: number }).diameter === 0.15)).toBe(true)
    expect(front.strokes.every((s) => s.aperture.fn === "Other,Legend")).toBe(true)
    const back = fileOf(read, "b-B_Silkscreen.gbo")
    expect(back.strokes.length).toBeGreaterThan(1)
    const xs = back.strokes.flatMap((s) => s.points.map((p) => p.x))
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 6)
    const u = back.strokes[0]?.points ?? []
    expect(u[0]?.x).toBeGreaterThan(u[u.length - 1]?.x ?? 0)
  })

  test("a second run writes the same bytes", () => {
    const pcb = board({ parts: [part([pad("1", {})], { silkscreen: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]] })], tracks: [track("top", [{ x: 0, y: 0 }, { x: 1, y: 0 }])], vias: [via(1, 0)] })
    expect(gerberFiles(pcb, PROFILE, "b", CREATED)).toEqual(gerberFiles(structuredClone(pcb), PROFILE, "b", CREATED))
  })
})
