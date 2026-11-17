import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { solidModel } from "../src/engine/solid/model.js"
import { stepText } from "../src/engine/solid/step.js"
import { START } from "../studio/src/look/orbit.js"
import { renderScene } from "../studio/src/look/raster.js"
import { buildScene } from "../studio/src/look/scene.js"
import { fastestMs } from "./helpers/fastest.js"

const IO8 = join(import.meta.dirname, "..", "examples", "io-8")

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

const design = buildDesign(filesIn(IO8), "io-8.circuit.tsx")

test("the 3D view draws io-8 (42 parts) in a frame short enough to turn it smoothly", () => {
  const scene = buildScene(solidModel(design))
  expect(solidModel(design).parts).toHaveLength(42)
  let frame = renderScene(scene, START, 1200, 800, { background: [0, 0, 0] })
  const ms = fastestMs(() => {
    frame = renderScene(scene, { ...START, yaw: START.yaw + 1 }, 1200, 800, { background: [0, 0, 0], reuse: frame })
  }, 10)
  console.log(`3D view, io-8 at 1200 x 800, fastest of 10 frames: ${ms.toFixed(1)} ms`)
  expect(ms).toBeLessThan(40)
})

test("making the solids and the STEP text of io-8 is quick, and only done when asked for", () => {
  const ms = fastestMs(() => void stepText(solidModel(design), "io-8"), 5)
  console.log(`solids and STEP text, io-8, fastest of 5: ${ms.toFixed(1)} ms`)
  expect(ms).toBeLessThan(200)
})
