import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { KicadError, readKicadBoard } from "../src/library/kicad/read.js"

const fixture = (name: string) => readFileSync(new URL(`./fixtures/kicad/${name}`, import.meta.url), "utf8")

interface PadRow {
  ref: string
  number: string
  x: number
  y: number
  width: number
  height: number
  drill: number
  plated: boolean
  bottom: boolean
  net: string
}

const board = fixture("fixture.kicad_pcb")
const pads = JSON.parse(fixture("fixture.pads.json")) as PadRow[]

describe("reading a board saved by KiCad 10", () => {
  const read = readKicadBoard(board)

  test("knows the version and centres the rounded outline", () => {
    expect(read.version).toBe(20260206)
    expect([read.board.width, read.board.height]).toEqual([50, 40])
    expect(read.board.offset).toEqual({ x: -125, y: 120 })
    expect(read.board.outline.length).toBeGreaterThan(8)
  })

  test("the footprint that holds only an unplated hole becomes a board hole", () => {
    expect(read.holeOnly).toEqual(["H1"])
    expect(read.board.holes).toEqual([{ x: -21, y: -16, diameter: 3.2 }])
    expect(read.parts.map((p) => p.ref).sort()).toEqual(["J1", "R1", "R2", "R3", ...Array.from({ length: 10 }, (_, i) => `U${i + 1}`)].sort())
  })

  test("every copper pad is where pcbnew put it, y turned up and the board centred", () => {
    for (const row of pads.filter((r) => r.plated)) {
      const part = read.parts.find((p) => p.ref === row.ref)
      const pad = part?.pads.find((p) => p.number === row.number)
      expect(pad, `${row.ref}.${row.number}`).toBeDefined()
      expect(pad?.world.x).toBeCloseTo(row.x - 125, 3)
      expect(pad?.world.y).toBeCloseTo(-row.y + 120, 3)
      expect([pad?.width, pad?.height]).toEqual([row.width, row.height])
      expect(pad?.net ?? "").toBe(row.net)
      if (row.drill > 0) expect(pad?.drill).toBe(row.drill)
    }
  })

  test("a part on the bottom has the land pattern it has on the top, at every turn", () => {
    const pattern = (ref: string) => read.parts.find((p) => p.ref === ref)?.pads.map(({ number, x, y, width, height, rotation }) => ({ number, x, y, width, height, rotation }))
    const first = pattern("U1")
    for (let i = 2; i <= 10; i++) expect(pattern(`U${i}`), `U${i}`).toEqual(first)
    expect(read.parts.find((p) => p.ref === "U6")).toMatchObject({ side: "bottom", rotation: 180 })
    expect(read.parts.find((p) => p.ref === "U2")).toMatchObject({ side: "top", rotation: 90 })
  })

  test("tracks, the arc as short pieces, the via and the pour", () => {
    expect(read.held).toMatchObject({ footprints: 15, segments: 3, arcs: 1, vias: 1, zones: 1 })
    expect(read.tracks).toHaveLength(4)
    const arc = read.tracks.find((t) => t.net === "Net-(R1-Pad2)")
    expect(arc?.points.length).toBeGreaterThan(4)
    expect(read.vias).toEqual([{ net: "GND", at: { x: 5, y: 8 }, diameter: 0.6, drill: 0.3 }])
    expect(read.pours).toHaveLength(1)
    expect(read.pours[0]).toMatchObject({ net: "GND", layer: "bottom", outline: [{ x: -24, y: 19 }, { x: 24, y: 19 }, { x: 24, y: -19 }, { x: -24, y: -19 }] })
  })

  test("keeps the origin when asked", () => {
    expect(readKicadBoard(board, { origin: "keep" }).board.offset).toEqual({ x: 0, y: 0 })
  })
})

describe("refusals", () => {
  const refused = (text: string) => {
    try {
      readKicadBoard(text)
    } catch (error) {
      expect(error).toBeInstanceOf(KicadError)
      return (error as Error).message
    }
    throw new Error("not refused")
  }

  test("a file that is not a KiCad board", () => {
    expect(refused("(kicad_sch (version 20250114))")).toBe("This is not a KiCad board: the file starts with (kicad_sch, not (kicad_pcb")
    expect(refused("PK\u0003\u0004 binary")).toBe("This is not a KiCad board, or it is damaged: The file does not start with a list")
  })

  test("a version older than KiCad 6", () => {
    expect(refused("(kicad_pcb (version 20171130) (host pcbnew 5.1.9))")).toBe(
      "This board was saved by KiCad 5 or older (file version 20171130); copperflow reads boards saved by KiCad 6 or newer (version 20211014 on). Open it in KiCad 6 or newer and save it again.",
    )
  })

  test("more than two copper layers", () => {
    const four = '(kicad_pcb (version 20260206) (layers (0 "F.Cu" signal) (4 "In1.Cu" signal) (6 "In2.Cu" signal) (2 "B.Cu" signal)))'
    expect(refused(four)).toBe("This board has 4 copper layers (F.Cu, In1.Cu, In2.Cu, B.Cu); copperflow builds two-layer boards, so it cannot be imported")
  })

  test("no closed outline", () => {
    expect(refused('(kicad_pcb (version 20260206) (layers (0 "F.Cu" signal) (2 "B.Cu" signal)))')).toBe("The board has no closed outline: there is nothing on Edge.Cuts")
    const open = '(kicad_pcb (version 20260206) (gr_line (start 0 0) (end 10 0) (layer "Edge.Cuts")) (gr_line (start 10 0) (end 10 5) (layer "Edge.Cuts")))'
    expect(refused(open)).toBe("The board has no closed outline on Edge.Cuts: found 1 open chain of 2 lines")
  })
})
