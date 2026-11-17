import { expect, test } from "vitest"
import { fastestMs } from "./helpers/fastest.js"
import { readKicadBoard } from "../src/library/kicad/read.js"

/** A board at the import's limits in kind: 2000 footprints of 8 pads and 50,000 tracks, all made up here. */
function largeBoard(): string {
  const footprints = Array.from({ length: 2000 }, (_, i) => {
    const pads = Array.from({ length: 8 }, (_, p) => `(pad "${p + 1}" smd rect (at ${p - 4} 0 ${i % 360}) (size 0.5 1) (layers "F.Cu" "F.Mask") (net "N${(i + p) % 500}"))`).join(" ")
    return `(footprint "made:Up8" (layer "F.Cu") (at ${(i % 50) * 10} ${Math.floor(i / 50) * 10} ${i % 360}) (property "Reference" "U${i + 1}") (property "Value" "X") ${pads})`
  })
  const tracks = Array.from({ length: 50_000 }, (_, i) => `(segment (start ${i % 500} ${i % 400}) (end ${(i % 500) + 1} ${i % 400}) (width 0.2) (layer "F.Cu") (net "N${i % 500}"))`)
  return `(kicad_pcb (version 20260206) (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user)) (gr_rect (start -10 -10) (end 510 410) (layer "Edge.Cuts")) ${footprints.join("\n")}\n${tracks.join("\n")})`
}

test("reads a board of 2000 footprints and 50,000 tracks in under 3 s", () => {
  const text = largeBoard()
  let parts = 0
  const ms = fastestMs(() => {
    parts = readKicadBoard(text).parts.length
  }, 3)
  console.log(`readKicadBoard 2000 footprints, 16,000 pads, 50,000 tracks (${(text.length / 1e6).toFixed(1)} MB), fastest of 3: ${ms.toFixed(1)} ms`)
  expect(parts).toBe(2000)
  expect(ms).toBeLessThan(3000)
})
