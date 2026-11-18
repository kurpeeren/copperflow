// The shape function of each surface-mount family of smd-family.ts; index.ts spreads them into its table.
import { arrayShape } from "./array.js"
import type { ShapeInput } from "./input.js"
import type { Piece } from "./kit.js"
import { ledSmdShape } from "./ledsmd.js"
import { melfShape } from "./melf.js"
import { plccShape } from "./plcc.js"
import type { SmdFamily } from "./smd-family.js"
import { smdCanShape } from "./smdcan.js"
import { tantalumShape } from "./tantalum.js"
import { xtalShape } from "./xtal.js"

export const SMD_SHAPES: Record<SmdFamily, (input: ShapeInput) => Piece[]> = {
  melf: melfShape,
  tantalum: tantalumShape,
  array: arrayShape,
  smdcan: smdCanShape,
  xtal: xtalShape,
  ledsmd: ledSmdShape,
  plcc: plccShape,
}
