import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { classLookup } from "../../src/engine/router/connect.js"
import { routerWorld } from "../../src/engine/router/grid.js"
import { keepClearOf } from "../../src/engine/router/keep-clear.js"
import { filesIn } from "../helpers/place-fixtures.js"

const FOLDER = join(import.meta.dirname, "..", "fixtures", "can-proof-3")
const MAIN = "can-module.circuit.tsx"
const LAYOUT = "can-module.circuit.layout.json"

/** The third proof board with no copper, GND poured on the layers given. */
function keepClear(layers: readonly ("top" | "bottom")[]) {
  const files = filesIn(FOLDER)
  const pours = layers.map((layer) => `<copperpour net="GND" layer="${layer}" />`).join("\n    ")
  const main = (files[MAIN] as string).replace('<copperpour net="GND" layer="top" />\n    <copperpour net="GND" layer="bottom" />', pours)
  const design = buildDesign({ ...files, [MAIN]: main, [LAYOUT]: `${(files[LAYOUT] as string).split("\n")[0]}\n` }, MAIN)
  expect(design.pcb.pours.map((pour) => pour.layer)).toEqual(layers)
  const world = routerWorld(design.pcb, design.rules, classLookup(design.rules, design.circuit.nets))
  return { keep: keepClearOf(world), layers: world.frame.layers }
}

const marked = (cells: Int32Array | undefined) => (cells ?? new Int32Array()).reduce((n, v) => n + (v === 0 ? 0 : 1), 0)

describe("keep-clear round pads a pour joins", () => {
  test("a net poured on one layer: the cells round its joined pads on that layer, and none on the other", () => {
    const { keep, layers } = keepClear(["top"])
    expect(keep?.nets).toEqual(["net.GND"])
    expect(marked(keep?.track[layers.indexOf("top")])).toBeGreaterThan(0)
    expect(marked(keep?.track[layers.indexOf("bottom")])).toBe(0)
  })

  test("a net poured on both layers gets none: a pad cut off from one fill reaches the other through a via", () => {
    expect(keepClear(["top", "bottom"]).keep).toBeUndefined()
  })
})
