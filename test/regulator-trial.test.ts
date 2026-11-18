// The small regulator board made through the agent's tools from nothing: a barrel jack too big for the first board,
// an LDO, two capacitors, a resistor, an LED and a header. One autoplace with fit: true places every part; autoroute
// leaves the connections of a part with no position waiting; a moved part's copper left behind is named; a pour's
// finding points inside the pour; a bottom track reads over the bottom pour in the picture.
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, test } from "vitest"
import { autoplace } from "../src/mcp/place-tools.js"
import { autoroute } from "../src/mcp/route-tools.js"
import { pointInPolygon } from "../src/engine/checks/geometry.js"
import { createCanvas, loadImage } from "@napi-rs/canvas"
import { worldToScreen } from "../studio/src/pcb/geometry.js"
import { renderDesign } from "../studio/src/render/node-render.js"
import { cameraFor, frameFor, imageSize, widthOf } from "../studio/src/render/render-frame.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "psu.circuit.tsx"
const JACK = `<chip name="J1" footprint="dcjack" pinLabels={{ pin1: "TIP", pin2: "SLEEVE", pin3: "SWITCH" }} noConnect="pin3"`
const LDO = `<chip name="U1" footprint="sot223" pinLabels={{ pin1: "GND", pin2: "VOUT", pin3: "VIN", pin4: "VOUT" }}`
const NETS = [
  ["J1.TIP", "V5"],
  ["U1.VIN", "V5"],
  ["C1.pin1", "V5"],
  ["J1.SLEEVE", "GND"],
  ["U1.GND", "GND"],
  ["C1.pin2", "GND"],
  ["C2.pin2", "GND"],
  ["D1.cathode", "GND"],
  ["J2.pin2", "GND"],
  ["U1.pin2", "V3_3"],
  ["U1.pin4", "V3_3"],
  ["C2.pin1", "V3_3"],
  ["R1.pin1", "V3_3"],
  ["J2.pin1", "V3_3"],
  ["R1.pin2", "LEDA"],
  ["D1.anode", "LEDA"],
]
/** The circuit as new_circuit wrote it: no part has a position, the board is 30 x 20 mm. */
const circuit = (jack = "", ldo = "", board = `width="30mm" height="20mm"`) => `export default () => (
  <board ${board}>
    ${JACK}${jack} />
    ${LDO}${ldo} />
    <capacitor name="C1" capacitance="10uF" footprint="0805" />
    <capacitor name="C2" capacitance="10uF" footprint="0805" />
    <resistor name="R1" resistance="1k" footprint="0603" />
    <led name="D1" color="green" footprint="0603" />
    <pinheader name="J2" pinCount={2} pitch="2.54mm" />
${NETS.map(([from, net]) => `    <trace from="${from}" to="net.${net}" />`).join("\n")}
  </board>
)
`

/** Every part placed by hand on a 40 x 30 mm board but the jack, which the build packs off the board. */
const placedButJack = circuit("", ` pcbX={0} pcbY={0}`, `width="40mm" height="30mm"`).replace(
  /(name="(C1|C2|R1|D1|J2)"[^>]*?)( \/>)/g,
  (_, head: string, name: string, end: string) => `${head} pcbX={${{ C1: 5, C2: -5, R1: 8, D1: 11, J2: -9 }[name]}} pcbY={-6}${end}`,
)

let root: string
const ports = () => ({ root, engine: inProcessEngine })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-trial-"))
  await writeFile(join(root, FILE), circuit())
})

describe("the regulator board through the agent's tools", () => {
  test("one autoplace with fit: true places the jack too, growing the board for it", async () => {
    const answer = await autoplace(ports(), { file: FILE, fit: true, budgetSeconds: 10 })
    expect(answer).toMatch(/^Placed 7 parts;/)
    expect(answer).not.toContain("Not placed")
    expect(answer).toMatch(/grown/)
    expect(await readFile(join(root, FILE), "utf8")).toMatch(/name="J1"[^>]*pcbX=/)
  })

  test("autoroute leaves the connections of a part with no position waiting, and says so", async () => {
    await writeFile(join(root, FILE), placedButJack)
    const answer = await autoroute(ports(), { file: FILE, budgetSeconds: 10 })
    expect(answer).toMatch(/connections? waits? for parts that are not placed: J1/)
    const routedLine = /Routed (\d+) of (\d+)/.exec(answer)
    expect(Number(routedLine?.[1])).toBeLessThan(Number(routedLine?.[2]))
    expect(answer).toMatch(/to J1\.pin1 \(not placed\) \(J1 is not placed\)/)
    expect(answer).toContain("2 connections wait for parts that are not placed: J1; place them (autoplace) and run autoroute again.")
    const design = await inProcessEngine.build(root, FILE)
    const jackPads = new Set(design.pcb.parts.filter((part) => part.component === "J1").flatMap((part) => part.pads.map((pad) => pad.id)))
    expect(design.pcb.tracks.filter((track) => track.pads.some((pad) => jackPads.has(pad)))).toEqual([])
  })

  test("autoplace names the copper a placed part leaves behind, and what to do with it", async () => {
    await writeFile(join(root, FILE), placedButJack)
    // A track drawn to where the build packed the jack, as an older autoroute did.
    const tip = (await inProcessEngine.build(root, FILE)).pcb.parts.find((part) => part.component === "J1")?.pads.find((pad) => pad.id === "J1#1")
    expect(tip).toBeDefined()
    const track = { t: "track", id: "t0001", net: "net.V5", layer: "bottom", width: 0.25, points: [{ x: 2.3, y: -3.075 }, { x: tip?.x, y: tip?.y }], locked: false, by: "router" }
    await writeFile(join(root, "psu.circuit.layout.json"), `${JSON.stringify({ t: "meta", next: { track: 2, via: 1 } })}\n${JSON.stringify(track)}\n`)
    expect((await inProcessEngine.build(root, FILE)).pcb.tracks[0]?.pads).toContain(tip?.id)
    const answer = await autoplace(ports(), { file: FILE, parts: ["J1"], fit: true, budgetSeconds: 10 })
    expect(answer).toMatch(/^Placed 1 part;/)
    expect(answer).toMatch(/Copper left behind: t0001 no longer ends on J1 pad 1[^.]*\. Remove it with remove_copper \{ ids: \["t0001"\] \} or unroute \{ nets: \["V5"\] \}, then autoroute\./)
  })

  test("a bottom pour's sparse warning points well inside the pour, on the board", async () => {
    // The board offset from the origin, as fit_board leaves it, with the parts on top and a GND pour below.
    const text = placedButJack.replace(`width="40mm" height="30mm"`, `width={27.2} height={21.8} pcbX={-4.3} pcbY={-0.9}`).replace(`noConnect="pin3"`, `noConnect="pin3" pcbX={-10} pcbY={0.5} pcbRotation={180}`)
    await writeFile(join(root, FILE), text.replace("  </board>", `    <copperpour net="GND" layer="bottom" />
  </board>`))
    const design = await inProcessEngine.build(root, FILE)
    const sparse = design.violations.find((v) => v.code === "pour-sparse")
    const fill = design.pcb.pours[0]
    expect(sparse?.at).toBeDefined()
    const at = sparse?.at ?? { x: 0, y: 0 }
    const inside = (fill?.polygons ?? []).some((piece) => pointInPolygon(at, piece.outer) && !piece.holes.some((hole) => pointInPolygon(at, hole)))
    expect(inside).toBe(true)
    // Not on the fill's rounded corner: a millimetre or more inside the board on every side.
    const [minX, maxX, minY, maxY] = [-17.9, 9.3, -11.8, 10]
    expect(Math.min(at.x - minX, maxX - at.x, at.y - minY, maxY - at.y)).toBeGreaterThan(1)
  })

  test("the PCB picture draws a bottom track clearly brighter than the bottom pour round it", async () => {
    await writeFile(join(root, FILE), placedButJack.replace("  </board>", `    <copperpour net="GND" layer="bottom" />
  </board>`))
    // A V5 track on the bottom from U1's input across the open board, where the GND pour lies on both sides of it.
    const track = { t: "track", id: "t0001", net: "net.V5", layer: "bottom", width: 0.25, points: [{ x: 2.3, y: 3.075 }, { x: 2.3, y: 12 }], locked: false, by: "router" }
    await writeFile(join(root, "psu.circuit.layout.json"), `${JSON.stringify({ t: "meta", next: { track: 2, via: 1 } })}
${JSON.stringify(track)}
`)
    const design = await inProcessEngine.build(root, FILE)
    const picture = await renderDesign(design, { view: "pcb" })
    const frame = frameFor(design, { view: "pcb" })
    const size = imageSize(frame.box, widthOf(undefined))
    const camera = cameraFor(frame.box, size)
    const canvas = createCanvas(picture.width, picture.height)
    const ctx = canvas.getContext("2d")
    ctx.drawImage(await loadImage(Buffer.from(picture.png)), 0, 0)
    const blue = (p: { x: number; y: number }) => {
      const at = worldToScreen(camera, size, p)
      return ctx.getImageData(Math.round(at.x), Math.round(at.y), 1, 1).data[2] as number
    }
    const [onTrack, onPour] = [blue({ x: 2.3, y: 8 }), blue({ x: 5.3, y: 8 })]
    expect(onPour).toBeGreaterThan(0)
    expect(onTrack).toBeGreaterThanOrEqual(2 * onPour)
  })
})
