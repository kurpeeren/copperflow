// A small single-stroke font for silkscreen text (designators and the board's own text): capitals, lower case, digits
// and the signs a board legend needs, each glyph a set of polylines on a 4 wide by 6 high grid; lower case stands 4
// high and its tails reach 2 below the line. copperflow's own glyphs. A character without a glyph is drawn as a box, so
// it is never silently lost; the board's text refuses one (undrawable).
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
  ":": "2,1 2,1;2,4 2,4",
  "%": "0,6 1,6 1,5 0,5 0,6;3,1 4,1 4,0 3,0 3,1;0,0 4,6",
  "=": "0,2 4,2;0,4 4,4",
  ",": "2,0 1,-1",
  "!": "2,6 2,2;2,0 2,0",
  "µ": "0,-2 0,4;0,1 1,0 3,0 4,1;4,4 4,0",
  ">": "1,5 3,3 1,1",
  "<": "3,5 1,3 3,1",
  "'": "2,6 2,4",
  "*": "2,1 2,5;0,2 4,4;0,4 4,2",
  a: "4,4 4,0;4,3 3,4 1,4 0,3 0,1 1,0 3,0 4,1",
  b: "0,6 0,0;0,1 1,0 3,0 4,1 4,3 3,4 1,4 0,3",
  c: "4,3 3,4 1,4 0,3 0,1 1,0 3,0 4,1",
  d: "4,6 4,0;4,1 3,0 1,0 0,1 0,3 1,4 3,4 4,3",
  e: "0,2 4,2 4,3 3,4 1,4 0,3 0,1 1,0 3,0 4,1",
  f: "3,6 2,6 1,5 1,0;0,4 3,4",
  g: "4,4 4,-1 3,-2 1,-2 0,-1;4,3 3,4 1,4 0,3 0,1 1,0 3,0 4,1",
  h: "0,6 0,0;0,3 1,4 3,4 4,3 4,0",
  i: "2,4 2,0;2,5.5 2,5.5",
  j: "3,4 3,-1 2,-2 1,-2 0,-1;3,5.5 3,5.5",
  k: "0,6 0,0;0,1 3,4;1,2 4,0",
  l: "1,6 2,6 2,1 3,0",
  m: "0,4 0,0;0,3 1,4 2,3 2,0;2,3 3,4 4,3 4,0",
  n: "0,4 0,0;0,3 1,4 3,4 4,3 4,0",
  o: "1,0 0,1 0,3 1,4 3,4 4,3 4,1 3,0 1,0",
  p: "0,4 0,-2;0,3 1,4 3,4 4,3 4,1 3,0 1,0 0,1",
  q: "4,4 4,-2;4,3 3,4 1,4 0,3 0,1 1,0 3,0 4,1",
  r: "0,4 0,0;0,2 2,4 4,4",
  s: "4,4 1,4 0,3 1,2 3,2 4,1 3,0 0,0",
  t: "1,6 1,1 2,0 3,0;0,4 3,4",
  u: "0,4 0,1 1,0 3,0 4,1;4,4 4,0",
  v: "0,4 2,0 4,4",
  w: "0,4 1,0 2,2 3,0 4,4",
  x: "0,0 4,4;0,4 4,0",
  y: "0,4 2,0;4,4 1,-2",
  z: "0,4 4,4 0,0 4,0",
  " ": "",
}
const MISSING = "0,0 4,0 4,6 0,6 0,0"

const GLYPH_WIDTH = 4
const GLYPH_HEIGHT = 6
/** From one glyph's left edge to the next one's. */
const ADVANCE = 6

/** The characters the font draws, in one line, for the words of a refusal. */
export const DRAWABLE_CHARACTERS = "A-Z a-z 0-9, space and - _ + . / ~ ( ) # : % = , ! µ > < ' *"

/** The characters of `text` the font has no glyph for, each once, in the order met. */
export function undrawable(text: string): string[] {
  return [...new Set([...text].filter((char) => !Object.hasOwn(GLYPHS, char)))]
}

function strokesOf(char: string): Point[][] {
  const glyph = (Object.hasOwn(GLYPHS, char) ? GLYPHS[char] : undefined) ?? MISSING
  if (glyph === "") return []
  return glyph.split(";").map((line) =>
    line.split(" ").map((pair) => {
      const [x, y] = pair.split(",").map(Number)
      return { x: x ?? 0, y: y ?? 0 }
    }),
  )
}

/** The width of the text drawn `height` tall, in the same unit: from the first glyph's left edge to the last one's right. */
export function textWidth(text: string, height: number): number {
  const count = [...text].length
  return count === 0 ? 0 : (((count - 1) * ADVANCE + GLYPH_WIDTH) * height) / GLYPH_HEIGHT
}

/**
 * The text as polylines in mm, `height` tall, centred on `at`; `mirrored` reverses it left to right, as text on the
 * bottom side reads from below; `turned` turns it a quarter turn counter-clockwise about `at`, to read from the bottom up.
 */
export function textStrokes(text: string, at: Point, height: number, mirrored = false, turned = false): Point[][] {
  const unit = height / GLYPH_HEIGHT
  const chars = [...text]
  const width = textWidth(text, GLYPH_HEIGHT)
  const side = mirrored ? -1 : 1
  return chars.flatMap((char, i) =>
    strokesOf(char).map((line) =>
      line.map((p) => {
        const dx = side * (i * ADVANCE + p.x - width / 2) * unit
        const dy = (p.y - GLYPH_HEIGHT / 2) * unit
        return turned ? { x: at.x - dy, y: at.y + dx } : { x: at.x + dx, y: at.y + dy }
      }),
    ),
  )
}
