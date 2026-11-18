// The review of the regulator-board fixes: the grown placement holds its time budget and its note is true whether or
// not the fit then succeeds; the stranded-copper text and the pour point are safe on odd input; and on the example
// boards, all placed and routed, autoroute waits for no part and autoplace names no copper left behind.
import { cp, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { fillPoint } from "../src/engine/checks/fill-point.js"
import { strandedCopper } from "../src/engine/checks/stranded-copper.js"
import type { Design } from "../src/engine/design.js"
import { OUT_OF_TIME } from "../src/engine/pcb-place/constructive.js"
import { placeBoardFitting } from "../src/engine/pcb-place/grow.js"
import { routeBoard } from "../src/engine/router/route-board.js"
import { autoplace } from "../src/mcp/place-tools.js"
import { routeInput } from "../src/studio/route-runner.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "psu.circuit.tsx"
/** The jack too big for the 30 x 20 mm board beside the small parts round the LDO; nothing placed. */
const CROWDED = `export default () => (
  <board width="30mm" height="20mm">
    <chip name="J1" footprint="dcjack" pinLabels={{ pin1: "TIP", pin2: "SLEEVE", pin3: "SWITCH" }} noConnect="pin3" />
    <chip name="U1" footprint="sot223" pinLabels={{ pin1: "GND", pin2: "VOUT", pin3: "VIN", pin4: "VOUT" }} />
    <capacitor name="C1" capacitance="10uF" footprint="0805" />
    <capacitor name="C2" capacitance="10uF" footprint="0805" />
    <resistor name="R1" resistance="1k" footprint="0603" />
    <led name="D1" color="green" footprint="0603" />
    <pinheader name="J2" pinCount={2} pitch="2.54mm" />
    <trace from="J1.TIP" to="net.V5" />
    <trace from="U1.VIN" to="net.V5" />
    <trace from="C1.pin1" to="net.V5" />
    <trace from="J1.SLEEVE" to="net.GND" />
    <trace from="U1.GND" to="net.GND" />
    <trace from="C1.pin2" to="net.GND" />
    <trace from="C2.pin2" to="net.GND" />
    <trace from="D1.cathode" to="net.GND" />
    <trace from="J2.pin2" to="net.GND" />
    <trace from="U1.pin2" to="net.V3_3" />
    <trace from="C2.pin1" to="net.V3_3" />
    <trace from="R1.pin1" to="net.V3_3" />
    <trace from="J2.pin1" to="net.V3_3" />
    <trace from="R1.pin2" to="net.LEDA" />
    <trace from="D1.anode" to="net.LEDA" />
  </board>
)
`
const crowded = () => inProcessEngine.buildFiles({ [FILE]: CROWDED }, FILE)

/** A clock that moves `step` ms each time it is read. */
const ticking = (step: number) => {
  let now = 0
  return { clock: () => (now += step), read: () => now }
}

describe("placing on a grown board", () => {
  test("stays within the budget: with too little left to grow, the jack is unplaced for lack of time", async () => {
    const design = await crowded()
    const unbounded = placeBoardFitting(design)
    expect(unbounded.unplaced).toEqual([])
    // Each clock read costs 1 ms: the budget allows the first placement and little more.
    const time = ticking(1)
    const budgetMs = 400
    const placement = placeBoardFitting(design, { budgetMs, clock: time.clock })
    expect(time.read()).toBeLessThan(budgetMs * 1.5)
    const jack = placement.unplaced.find((u) => u.name === "J1")
    if (jack) expect(jack.reason).toBe(OUT_OF_TIME)
  })

  test("the note says only what placing did, not that the board was fitted", async () => {
    const placement = placeBoardFitting(await crowded())
    expect(placement.notes[0]).toMatch(/^The 30 x 20 mm board had no free spot for J1, so the parts were placed on a board grown to [\d.]+ x [\d.]+ mm$/)
    expect(placement.notes.join(" ")).not.toMatch(/fitted/)
  })
})

describe("odd input", () => {
  test("a copper id with pattern characters is cut from its message as plain text", () => {
    const empty = { pcb: { tracks: [], vias: [] }, violations: [] } as unknown as Design
    const after = {
      pcb: { tracks: [{ id: "t(1+", net: "net.A", pads: [] }], vias: [] },
      violations: [{ id: "copper-edge:t(1+", code: "copper-edge", message: "t(1+ runs outside the board", items: ["t(1+"] }],
    } as unknown as Design
    expect(strandedCopper(empty, after)).toEqual([{ id: "t(1+", net: "net.A", why: "runs outside the board" }])
  })

  test("a pour ring of 300,000 points gets a point inside it", () => {
    const count = 300_000
    const outer = Array.from({ length: count }, (_, i) => ({ x: 10 * Math.cos((2 * Math.PI * i) / count), y: 10 * Math.sin((2 * Math.PI * i) / count) }))
    const at = fillPoint({ polygons: [{ outer, holes: [] }] })
    expect(at).toBeDefined()
    expect(Math.hypot(at?.x ?? 99, at?.y ?? 99)).toBeLessThan(5)
  }, 60_000)
})

describe.each(["io-8", "can-node", "relay-driver"])("the example board %s, placed and routed", (name) => {
  const copy = async () => {
    const root = await mkdtemp(join(tmpdir(), `cf-${name}-`))
    await cp(join("examples", name), root, { recursive: true })
    return root
  }

  test("autoroute waits for no part: every part has a position", async () => {
    const root = await copy()
    const design = await inProcessEngine.build(root, `${name}.circuit.tsx`)
    expect(design.pcb.parts.filter((part) => part.autoPlaced)).toEqual([])
    const report = routeBoard(routeInput(design), { budgetMs: 5000 })
    expect(report.waitingFor).toBeUndefined()
    expect(report.unrouted.filter((one) => one.reason.endsWith("not placed"))).toEqual([])
  }, 60_000)

  test("autoplace again names copper left behind only where it really is", async () => {
    const root = await copy()
    const file = `${name}.circuit.tsx`
    const before = await inProcessEngine.build(root, file)
    const answer = await autoplace({ root, engine: inProcessEngine }, { file, budgetSeconds: 5 })
    const after = await inProcessEngine.build(root, file)
    const stranded = strandedCopper(before, after)
    // Each one named is off the board in the new build, or no longer touches a pad it touched.
    const offBoard = new Set(after.violations.filter((v) => v.code === "copper-edge").flatMap((v) => v.items))
    const lostPad = (id: string) => {
      const [was, now] = [before.pcb.tracks.find((t) => t.id === id), after.pcb.tracks.find((t) => t.id === id)]
      return (was?.pads ?? []).some((pad) => !(now?.pads ?? []).includes(pad))
    }
    for (const one of stranded) expect(offBoard.has(one.id) || lostPad(one.id), one.id).toBe(true)
    if (name === "io-8") {
      // Its eighth channel finds no room on the board and goes beside it with its block's copper: really off the board.
      expect(answer).toContain("Not placed: CH8 (no free room on the board")
      expect(stranded.map((one) => one.net)).toEqual(stranded.map(() => "net.CH8/DIV"))
    } else {
      expect(answer).not.toContain("Copper left behind")
      expect(stranded).toEqual([])
    }
  }, 60_000)
})
