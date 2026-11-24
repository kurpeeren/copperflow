import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../src/engine/design.js"
import { easyedaExport, easyedaText } from "../src/engine/fab/easyeda.js"
import { allShapes, readEasyeda, readHole, readPad, readPoints, readShape, readTrack, readVia, type ReadDocument } from "../src/engine/fab/easyeda-read.js"
import { filesIn } from "./helpers/place-fixtures.js"

const EXAMPLES = join(import.meta.dirname, "..", "examples")
const example = (name: string): Design => buildDesign(filesIn(join(EXAMPLES, name)), `${name}.circuit.tsx`)
const COPPER = new Set([1, 2, 21, 22])
const roundTrip = (design: Design): ReadDocument => readEasyeda(easyedaText(easyedaExport(design).document))

/** A 4-layer board with a part turned on the top, one on the bottom, texts on both sides and a hole. */
const SIDES = `export default () => (
  <board width="30mm" height="20mm" layers={4}>
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={-5} pcbY={0} pcbRotation={90} />
    <resistor name="R2" resistance="10k" footprint="0805" pcbX={5} pcbY={2} pcbRotation={30} layer="bottom" />
    <silkscreentext text="PCB" x={0} y={8} />
    <silkscreentext text="BOTTOM" x={-3} y={-8} layer="bottom" rotation={90} />
    <hole x={10} y={-5} diameter={3.2} />
  </board>
)
`

describe("an example board exported", () => {
  const design = example("relay-driver")
  const exported = easyedaExport(design)
  const document = readEasyeda(easyedaText(exported.document))
  const shapes = allShapes(document)
  const of = (kind: string) => shapes.filter((shape) => shape.kind === kind)
  const placed = design.pcb.parts.filter((part) => part.footprint !== undefined)

  test("is an EasyEDA PCB document whose origin is the board's (0, 0)", () => {
    expect(exported.document.head.docType).toBe("3")
    expect(document.origin).toEqual({ x: 4000, y: 3000 })
    expect(exported.document.canvas.split("~").slice(-2)).toEqual(["4000", "3000"])
  })

  test("has a footprint per part, with every pad, and the same counts it reports", () => {
    expect(of("LIB")).toHaveLength(placed.length)
    expect(of("PAD")).toHaveLength(placed.reduce((sum, part) => sum + part.pads.length, 0))
    expect(exported.counts.parts).toBe(placed.length)
    expect(exported.counts.pads).toBe(of("PAD").length)
    expect(exported.counts.tracks).toBe(design.pcb.tracks.length)
    expect(exported.counts.pours).toBe(design.pcb.board?.pours?.length)
  })

  test("writes each track on its layer with its net, width and points", () => {
    const tracks = document.shapes.filter((shape) => shape.kind === "TRACK").map((shape) => readTrack(shape, document.origin)).filter((track) => COPPER.has(track.layer))
    expect(tracks).toHaveLength(design.pcb.tracks.length)
    design.pcb.tracks.forEach((track, i) => {
      const read = tracks[i]
      expect(read?.net).toBe(track.net?.replace(/^net\./, ""))
      expect(read?.layer).toBe(track.layer === "top" ? 1 : 2)
      expect(read?.width).toBeCloseTo(track.width, 3)
      read?.points.forEach((p, j) => {
        expect(p.x).toBeCloseTo(track.points[j]?.x ?? NaN, 3)
        expect(p.y).toBeCloseTo(track.points[j]?.y ?? NaN, 3)
      })
    })
  })

  test("puts each pad where the board has it, with its net and number", () => {
    const pads = placed.flatMap((part) => part.pads)
    const read = of("PAD").map((shape) => readPad(shape, document.origin))
    pads.forEach((pad, i) => {
      const back = read[i]
      expect(back?.at.x).toBeCloseTo(pad.x, 3)
      expect(back?.at.y).toBeCloseTo(pad.y, 3)
      expect(back?.number).toBe(pad.number)
      expect(back?.net).toBe(pad.net?.replace(/^net\./, "") ?? "")
      expect(back?.drill).toBeCloseTo(pad.drill?.width ?? 0, 3)
    })
  })

  test("keeps every net the copper names", () => {
    const written = new Set([...of("PAD").map((s) => readPad(s, document.origin).net), ...of("TRACK").map((s) => readTrack(s, document.origin).net)].filter((net) => net !== ""))
    const nets = new Set(design.circuit.nets.map((net) => net.id.replace(/^net\./, "")))
    for (const net of written) expect(nets.has(net)).toBe(true)
    const used = new Set([...design.pcb.tracks.flatMap((t) => (t.net ? [t.net] : [])), ...placed.flatMap((p) => p.pads.flatMap((pad) => (pad.net ? [pad.net] : [])))].map((net) => net.replace(/^net\./, "")))
    expect(written).toEqual(used)
    expect(exported.counts.nets).toBe(design.circuit.nets.length)
  })

  test("closes the board outline on the outline layer and fills its box", () => {
    const outline = of("TRACK").map((s) => readTrack(s, document.origin)).filter((t) => t.layer === 10)
    expect(outline).toHaveLength(1)
    const points = outline[0]?.points ?? []
    expect(points[0]).toEqual(points[points.length - 1])
    expect(exported.document.BBox.width).toBeGreaterThan(0)
  })

  test("writes the pours as copper areas on their layer and net, to be filled in the editor", () => {
    const areas = of("COPPERAREA")
    expect(areas).toHaveLength(1)
    expect(areas[0]?.fields.slice(1, 3)).toEqual(["2", "GND"])
    expect(areas[0]?.fields[9]).toBe("[]")
  })

  test("prints each shown designator and hides each value", () => {
    const texts = of("TEXT")
    expect(texts.filter((t) => t.fields[0] === "P")).toHaveLength(placed.length)
    expect(texts.filter((t) => t.fields[0] === "N").every((t) => t.fields[11] === "none")).toBe(true)
  })

  test("writes the same document every time", () => {
    expect(easyedaText(easyedaExport(design).document)).toBe(easyedaText(exported.document))
    expect(exported.left).toEqual([])
  })
})

describe("holes, vias and drawings", () => {
  const design = example("usb-c-3v3")
  const document = roundTrip(design)
  const top = (kind: string) => document.shapes.filter((shape) => shape.kind === kind)

  test("writes each hole with its diameter and each via with its drill", () => {
    const holes = top("HOLE").map((s) => readHole(s, document.origin))
    expect(holes).toHaveLength(design.pcb.holes.length)
    holes.forEach((hole, i) => {
      expect(hole.diameter).toBeCloseTo(design.pcb.holes[i]?.diameter ?? NaN, 3)
      expect(hole.at.x).toBeCloseTo(design.pcb.holes[i]?.x ?? NaN, 3)
    })
    const vias = top("VIA").map((s) => readVia(s, document.origin))
    expect(vias).toHaveLength(design.pcb.vias.length)
    vias.forEach((via, i) => {
      expect(via.drill).toBeCloseTo(design.pcb.vias[i]?.drill ?? NaN, 3)
      expect(via.diameter).toBeCloseTo(design.pcb.vias[i]?.diameter ?? NaN, 3)
    })
  })

  test("writes the board's drawings as solid regions and tracks on their layers", () => {
    const graphics = design.pcb.graphics ?? []
    const areas = graphics.reduce((sum, graphic) => sum + graphic.areas.length, 0)
    expect(top("SOLIDREGION")).toHaveLength(areas)
  })
})

describe("parts on both sides of a 4-layer board", () => {
  const design = buildDesign({ "sides.circuit.tsx": SIDES }, "sides.circuit.tsx")
  const exported = easyedaExport(design)
  const document = readEasyeda(easyedaText(exported.document))
  const libs = document.shapes.filter((shape) => shape.kind === "LIB")

  test("marks each footprint with its side, turn and the layers of its pads and silkscreen", () => {
    const [r1, c2] = libs
    expect(r1?.fields[3]).toBe("90")
    expect(r1?.fields[6]).toBe("1")
    expect(c2?.fields[6]).toBe("2")
    const padLayers = (lib: typeof r1) => new Set(lib?.children.filter((c) => c.kind === "PAD").map((c) => c.fields[5]))
    expect(padLayers(r1)).toEqual(new Set(["1"]))
    expect(padLayers(c2)).toEqual(new Set(["2"]))
    const silk = (lib: typeof r1) => new Set(lib?.children.filter((c) => c.kind === "TEXT" || c.kind === "TRACK").map((c) => c.fields[c.kind === "TEXT" ? 6 : 1]))
    expect(silk(r1)).toEqual(new Set(["3", "13"]))
    expect(silk(c2)).toEqual(new Set(["4", "14"]))
  })

  test("mirrors the bottom designator and the bottom text", () => {
    const designators = libs.map((lib) => lib.children.find((c) => c.kind === "TEXT" && c.fields[0] === "P"))
    expect(designators.map((t) => t?.fields[5])).toEqual(["0", "1"])
    const texts = document.shapes.filter((shape) => shape.kind === "TEXT")
    expect(texts.map((t) => [t.fields[9], t.fields[5], t.fields[6], t.fields[4]])).toEqual([
      ["PCB", "0", "3", "0"],
      ["BOTTOM", "1", "4", "90"],
    ])
  })

  test("starts each text where its first letter's stroke starts (each word here starts at its letter's corner)", () => {
    const texts = [...document.shapes, ...libs.flatMap((lib) => lib.children)].filter((t) => t.kind === "TEXT" && t.fields[11] !== "none")
    expect(texts.map((t) => t.fields[9])).toEqual(["PCB", "BOTTOM", "R1", "R2"])
    for (const text of texts) {
      const [x, y] = (text.fields[10] ?? "").split(" ").slice(1, 3)
      expect([text.fields[1], text.fields[2]], text.fields[9]).toEqual([x, y])
    }
  })

  test("writes each pad of a turned part on the bottom with the board's turn, size and corners", () => {
    const pads = design.pcb.parts.flatMap((part) => part.pads)
    const read = libs.flatMap((lib) => lib.children.filter((c) => c.kind === "PAD"))
    expect(read).toHaveLength(pads.length)
    pads.forEach((pad, i) => {
      const shape = read[i] as (typeof read)[number]
      const back = readPad(shape, document.origin)
      expect(back.rotation).toBeCloseTo(pad.rotation, 3)
      expect(back.width).toBeCloseTo(pad.width, 3)
      expect(back.height).toBeCloseTo(pad.height, 3)
      const corners = readPoints(shape.fields[9] ?? "", document.origin)
      const turn = (pad.rotation * Math.PI) / 180
      const expected = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => {
        const [lx, ly] = [((sx as number) * pad.width) / 2, ((sy as number) * pad.height) / 2]
        return { x: pad.x + lx * Math.cos(turn) - ly * Math.sin(turn), y: pad.y + lx * Math.sin(turn) + ly * Math.cos(turn) }
      })
      corners.forEach((corner, j) => {
        expect(corner.x).toBeCloseTo(expected[j]?.x ?? NaN, 3)
        expect(corner.y).toBeCloseTo(expected[j]?.y ?? NaN, 3)
      })
    })
    expect(new Set(pads.map((pad) => Math.round(pad.rotation)))).toEqual(new Set([90, 330]))
  })

  test("uses the inner layers of a 4-layer board and none of a 2-layer one", () => {
    expect(exported.document.layers.find((layer) => layer.startsWith("21~"))).toBe("21~Inner1~#999966~true~false~true~")
    const two = easyedaExport(buildDesign({ "sides.circuit.tsx": SIDES.replace(" layers={4}", "") }, "sides.circuit.tsx"))
    expect(two.document.layers.find((layer) => layer.startsWith("21~"))).toBe("21~Inner1~#999966~false~false~false~")
  })

  test("writes the hole where it is, by its size, and both texts", () => {
    expect(exported.counts).toMatchObject({ holes: 1, texts: 2, vias: 0, tracks: 0 })
    const hole = readHole(document.shapes.find((shape) => shape.kind === "HOLE") as (typeof document.shapes)[number], document.origin)
    expect(hole.at.x).toBeCloseTo(10, 3)
    expect(hole.at.y).toBeCloseTo(-5, 3)
    expect(hole.diameter).toBeCloseTo(3.2, 3)
  })
})

describe("what the document leaves out", () => {
  const design = buildDesign({ "sides.circuit.tsx": SIDES }, "sides.circuit.tsx")

  test("names parts without a footprint, copper on missing layers and keepouts", () => {
    const pcb = design.pcb
    const track = { id: "t9", layer: "inner1" as const, width: 0.2, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], locked: false, by: "human" as const, pads: [], missingLayer: "inner1" as const }
    const via = { id: "v9", at: { x: 0, y: 0 }, drill: 0.3, diameter: 0.6, layers: ["top" as const, "inner2" as const], locked: false, by: "human" as const, missingLayer: "inner2" as const }
    const keepout = { id: "keepout:1", outline: [], layers: "all" as const, source: { file: "sides.circuit.tsx", line: 1, column: 1, offset: 0 } }
    const board = pcb.board ? { ...pcb.board, keepouts: [keepout] } : undefined
    const bare = { ...(pcb.parts[0] as (typeof pcb.parts)[number]), component: "X1", pads: [] }
    delete (bare as { footprint?: unknown }).footprint
    const changed: Design = { ...design, pcb: { ...pcb, ...(board ? { board } : {}), parts: [...pcb.parts, bare], tracks: [track], vias: [via] } }
    const exported = easyedaExport(changed)
    expect(exported.left).toEqual([
      "Parts without a footprint (no pads to write): X1",
      "Tracks on a copper layer the board lacks: t9",
      "Vias on a copper layer the board lacks: v9",
      "Keepouts (the format has no keepout the export can rely on): keepout:1",
    ])
    expect(exported.counts).toMatchObject({ parts: 2, tracks: 0, vias: 0 })
  })

  test("a board without an outline has no outline track and an empty box at the origin", () => {
    const { board: _board, ...rest } = design.pcb
    const exported = easyedaExport({ ...design, pcb: rest })
    expect(exported.document.BBox).toEqual({ x: 4000, y: 3000, width: 0, height: 0 })
    expect(exported.document.shape.some((line) => line.startsWith("TRACK~") && line.split("~")[2] === "10")).toBe(false)
    expect(exported.document.shape.some((line) => line.startsWith("COPPERAREA~"))).toBe(false)
  })

  test("a pour with no area to fill is left out", () => {
    const relay = example("relay-driver")
    const board = relay.pcb.board
    if (board === undefined) throw new Error("the example has a board")
    const exported = easyedaExport({ ...relay, pcb: { ...relay.pcb, board: { ...board, outline: [] } } })
    expect(exported.counts.pours).toBe(0)
    expect(exported.document.shape.some((line) => line.startsWith("COPPERAREA~"))).toBe(false)
  })
})

describe("the reader", () => {
  test("refuses what is not an EasyEDA PCB document", () => {
    expect(() => readEasyeda(JSON.stringify({ head: { docType: "1" } }))).toThrow("not an EasyEDA PCB document (docType 1)")
    expect(() => readEasyeda(JSON.stringify({ head: { docType: "3", x: "0", y: "0" }, shape: [1] }))).toThrow("not a list of strings")
    expect(() => readEasyeda(JSON.stringify({ head: { docType: "3", x: "", y: "0" }, shape: [] }))).toThrow("head x is empty")
    expect(() => readEasyeda(JSON.stringify({ head: { docType: "3", x: "a", y: "0" }, shape: [] }))).toThrow("head x is not a number: a")
  })

  test("refuses a point list with an odd number of coordinates or a field that is not a number", () => {
    expect(() => readPoints("1 2 3", { x: 0, y: 0 })).toThrow("odd number")
    expect(readPoints("  ", { x: 0, y: 0 })).toEqual([])
    expect(() => readTrack(readShape("TRACK~wide~1~~1 2~gge1~0"), { x: 0, y: 0 })).toThrow("TRACK width is not a number: wide")
  })

  test("reads the editor's own shape lines", () => {
    const origin = { x: 4020, y: 3424 }
    const pad = readPad(readShape("PAD~ELLIPSE~4252~3212~7.874~7.874~11~NET1~~1.9685~~0~gge1~0~~Y~0~~~4252,3212"), origin)
    expect(pad.shape).toBe("ELLIPSE")
    expect(pad.width).toBeCloseTo(2, 4)
    expect(pad.drill).toBeCloseTo(1, 4)
    expect(pad.at.x).toBeCloseTo(58.928, 3)
    expect(pad.at.y).toBeCloseTo(53.848, 3)
    const lib = readShape("LIB~4270~3065~package`X`~180~~gge2~2~~~0~~yes~~#@$TRACK~1~4~~4138 3078 4401 3078~gge3~0")
    expect([lib.kind, lib.fields[3], lib.children.map((c) => c.kind)]).toEqual(["LIB", "180", ["TRACK"]])
  })
})
