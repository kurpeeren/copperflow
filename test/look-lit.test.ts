import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, test } from "vitest"
import { buildDesign, type Design } from "../src/engine/design.js"
import { boardPicture } from "../src/engine/fab/picture/board-picture.js"
import { FINISHES } from "../src/engine/fab/picture/looks.js"
import { solidModel } from "../src/engine/solid/model.js"
import { KEY_LIGHT } from "../studio/src/look/light.js"
import { project, START, TOP, BOTTOM, viewFrame, type Orbit } from "../studio/src/look/orbit.js"
import { renderScene } from "../studio/src/look/raster.js"
import { buildScene, type Face, type Rgb, type Scene } from "../studio/src/look/scene.js"
import { boardTextures, textureStore, type BoardTextures } from "../studio/src/look/texture.js"

function filesIn(folder: string): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else files[relative(folder, path).split("\\").join("/")] = readFileSync(path, "utf8")
    }
  }
  walk(folder)
  return files
}

const io8: Design = buildDesign(filesIn(join(import.meta.dirname, "..", "examples", "io-8")), "io-8.circuit.tsx")
const model = solidModel(io8)
const MAGENTA: Rgb = [255, 0, 255]
const SIZE = 900

/** The same colour, perhaps in shadow: compared after both are brought to the same brightness. */
const near = (rgb: readonly number[], want: readonly number[], tolerance: number) => {
  const k = Math.max(...want) / Math.max(1, ...rgb)
  return Math.max(...rgb.map((v, i) => Math.abs(v * k - (want[i] as number)))) <= tolerance
}

/** The colour at a board point as a lit view from `orbit` draws it. */
function colourAt(scene: Scene, orbit: Orbit, x: number, y: number, z: number): number[] {
  const frame = renderScene(scene, orbit, SIZE, SIZE, { background: MAGENTA, lit: true })
  const p = project(viewFrame(orbit, scene, SIZE, SIZE), [x, y, z])
  const i = Math.floor(p.y) * SIZE + Math.floor(p.x)
  return [frame.color[i * 4] as number, frame.color[i * 4 + 1] as number, frame.color[i * 4 + 2] as number]
}

describe("the board's picture on its faces", () => {
  const textures = boardTextures(io8, solidModel(io8), {})
  // The board alone: what is checked is how its faces are painted.
  const bare = buildScene(model, { parts: [], textures, look: {} })
  const t = model.board!.thickness
  const finish = FINISHES.enig.face

  test("the top: a pad of R101 shows the finish at the pixel its middle projects to, and a point beside it does not", () => {
    const pad = io8.pcb.parts.find((p) => p.component === "R101")!.pads[0]!
    expect(near(colourAt(bare, TOP, pad.x, pad.y, t), finish, 30)).toBe(true)
    expect(near(colourAt(bare, TOP, pad.x - 1.6, pad.y, t), finish, 30)).toBe(false)
  })

  test("the bottom: J1's pad 1 ring shows the finish seen from below, and the hole is see-through", () => {
    const pad = io8.pcb.parts.find((p) => p.component === "J1")!.pads.find((p) => p.number === "1")!
    const ring = (pad.drill!.width / 2 + Math.min(pad.width, pad.height) / 2) / 2
    expect(near(colourAt(bare, BOTTOM, pad.x + ring, pad.y, 0), finish, 30)).toBe(true)
    expect(colourAt(bare, BOTTOM, pad.x, pad.y, 0)).toEqual([...MAGENTA])
    expect(colourAt(bare, TOP, pad.x, pad.y, t)).toEqual([...MAGENTA])
  })

  test("the picture is made once for a design and look, whatever the view does", () => {
    let made = 0
    const counting = (...args: Parameters<typeof boardPicture>) => {
      made += 1
      return boardPicture(args[0], { ...args[1], pxPerMm: 4 })
    }
    const store = textureStore(counting)
    let textures: BoardTextures | undefined
    for (const orbit of [START, TOP, BOTTOM, { ...START, yaw: 70 }, { ...START, zoom: 6 }, { ...START, zoom: 0.4 }]) {
      textures = store.get(io8, model, { mask: "green" })
      renderScene(buildScene(model, { textures, look: { mask: "green" } }), orbit, 200, 150, { background: MAGENTA, lit: true })
    }
    expect(made).toBe(2)
    store.get(io8, model, { mask: "black" })
    expect(made).toBe(4)
    store.get(io8, model, { mask: "black" })
    expect(made).toBe(4)
  })
})

describe("the light", () => {
  const box = (normal: [number, number, number], loop: [number, number, number][]): Face => ({ loops: [loop], normal, color: [150, 150, 150], alpha: 1, part: 0, material: "matt" })
  const cube: Scene = {
    faces: [
      box([0, 0, 1], [[0, 0, 4], [4, 0, 4], [4, 4, 4], [0, 4, 4]]),
      box([0, -1, 0], [[0, 0, 0], [4, 0, 0], [4, 0, 4], [0, 0, 4]]),
      box([-1, 0, 0], [[0, 4, 0], [0, 0, 0], [0, 0, 4], [0, 4, 4]]),
    ],
    bounds: [[0, 0, 0], [4, 4, 4]],
  }

  test("comes from above and from the side the front face turns away from", () => {
    expect(KEY_LIGHT[2]).toBeGreaterThan(0)
    expect(KEY_LIGHT[1]).toBeGreaterThan(0)
  })

  test("a top face is lighter than a side face turned away from it", () => {
    const top = colourAt(cube, START, 2, 2, 4)
    const front = colourAt(cube, START, 2, 0, 2)
    expect(top[0]).toBeGreaterThan((front[0] as number) + 20)
  })

  test("a part casts its soft shadow on the board on the side away from the light", () => {
    const main = "main.circuit.tsx"
    const design = buildDesign({ [main]: `export default () => (<board width="20mm" height="20mm"><capacitor name="C1" capacitance="10uF" footprint="radial6.3x2.5" pcbX={0} pcbY={0} /></board>)` }, main)
    const solids = solidModel(design)
    const top = boardTextures(design, solids, {}, (d, o) => boardPicture(d, { ...o, pxPerMm: 10 })).top!
    const shade = (x: number, y: number) => {
      const u = Math.floor(top.origin.x + x * top.pxPerMm)
      const v = Math.floor(top.origin.y - y * top.pxPerMm)
      const i = (v * top.width + u) * 4
      return (top.rgba[i] as number) + (top.rgba[i + 1] as number) + (top.rgba[i + 2] as number)
    }
    const [lx, ly] = [KEY_LIGHT[0], KEY_LIGHT[1]]
    const length = Math.hypot(lx, ly)
    const reach = 4.6
    const away = shade((-lx / length) * reach, (-ly / length) * reach)
    const toward = shade((lx / length) * reach, (ly / length) * reach)
    expect(away).toBeLessThan(toward - 15)
  })
})
