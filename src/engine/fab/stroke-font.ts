// A small single-stroke font for silkscreen text (designators): capitals, digits and a few signs, each glyph a set of
// polylines on a 4 wide by 6 high grid. copperflow's own glyphs. Lower case is drawn as upper case; a character
// without a glyph is drawn as a box, so it is never silently lost.
import type { Point } from "../model.js"

/** Glyph polylines: points "x,y" separated by spaces, polylines by ";". */
const GLYPHS: Readonly<Record<string, string>> = {
  A: "0,0 0,4 2,6 4,4 4,0;0,3 4,3",
  B: "0,0 0,6 3,6 4,5 4,4 3,3 0,3;3,3 4,2 4,1 3,0 0,0",
  C: "4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5",
  D: "0,0 0,6 3,6 4,5 4,1 3,0 0,0",
  E: "4,0 0,0 0,6 4,6;0,3 3,3",
  F: "0,0 0,6 4,6;0,3 3,3",
  G: "4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,3 2,3",
  H: "0,0 0,6;4,0 4,6;0,3 4,3",
  I: "1,0 3,0;2,0 2,6;1,6 3,6",
  J: "0,1 1,0 2,0 3,1 3,6;2,6 4,6",
  K: "0,0 0,6;4,6 0,2;1,3 4,0",
  L: "0,6 0,0 4,0",
  M: "0,0 0,6 2,3 4,6 4,0",
  N: "0,0 0,6 4,0 4,6",
  O: "1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0",
  P: "0,0 0,6 3,6 4,5 4,4 3,3 0,3",
  Q: "1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0;2,2 4,0",
  R: "0,0 0,6 3,6 4,5 4,4 3,3 0,3;2,3 4,0",
  S: "4,5 3,6 1,6 0,5 0,4 1,3 3,3 4,2 4,1 3,0 1,0 0,1",
  T: "0,6 4,6;2,6 2,0",
  U: "0,6 0,1 1,0 3,0 4,1 4,6",
  V: "0,6 2,0 4,6",
  W: "0,6 1,0 2,3 3,0 4,6",
  X: "0,0 4,6;0,6 4,0",
  Y: "0,6 2,3 4,6;2,3 2,0",
  Z: "0,6 4,6 0,0 4,0",
  "0": "1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0;0,1 4,5",
  "1": "1,5 2,6 2,0;1,0 3,0",
  "2": "0,5 1,6 3,6 4,5 4,4 0,0 4,0",
  "3": "0,5 1,6 3,6 4,5 4,4 3,3 4,2 4,1 3,0 1,0 0,1;1,3 3,3",
  "4": "3,0 3,6 0,2 4,2",
  "5": "4,6 0,6 0,3 3,3 4,2 4,1 3,0 1,0 0,1",
  "6": "4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2 3,3 0,3",
  "7": "0,6 4,6 1,0",
  "8": "1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3 1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3",
  "9": "0,1 1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,4 1,3 4,3",
  "-": "1,3 3,3",
  _: "0,0 4,0",
  "+": "2,1 2,5;0,3 4,3",
  ".": "2,0 2,0",
  "/": "0,0 4,6",
  "~": "0,3 1,4 3,2 4,3",
  "(": "3,6 2,5 2,1 3,0",
  ")": "1,6 2,5 2,1 1,0",
  "#": "1,0 1,6;3,0 3,6;0,2 4,2;0,4 4,4",
  " ": "",
}
const MISSING = "0,0 4,0 4,6 0,6 0,0"

const GLYPH_WIDTH = 4
const GLYPH_HEIGHT = 6
/** From one glyph's left edge to the next one's. */
const ADVANCE = 6

function strokesOf(char: string): Point[][] {
  const glyph = GLYPHS[char.toUpperCase()] ?? MISSING
  if (glyph === "") return []
  return glyph.split(";").map((line) =>
    line.split(" ").map((pair) => {
      const [x, y] = pair.split(",").map(Number)
      return { x: x ?? 0, y: y ?? 0 }
    }),
  )
}

/**
 * The text as polylines in mm, `height` tall, centred on `at`; `mirrored` reverses it left to right, as text on the
 * bottom side reads from below.
 */
export function textStrokes(text: string, at: Point, height: number, mirrored = false): Point[][] {
  const unit = height / GLYPH_HEIGHT
  const chars = [...text]
  const width = chars.length === 0 ? 0 : (chars.length - 1) * ADVANCE + GLYPH_WIDTH
  const side = mirrored ? -1 : 1
  return chars.flatMap((char, i) =>
    strokesOf(char).map((line) =>
      line.map((p) => ({
        x: at.x + side * (i * ADVANCE + p.x - width / 2) * unit,
        y: at.y + (p.y - GLYPH_HEIGHT / 2) * unit,
      })),
    ),
  )
}
