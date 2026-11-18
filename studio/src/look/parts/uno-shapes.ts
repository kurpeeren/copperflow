// The shape function of each family of uno-family.ts; index.ts spreads them into its table.
import { dcJackShape } from "./dcjack.js"
import { inductorShape } from "./inductor.js"
import type { ShapeInput } from "./input.js"
import type { Piece } from "./kit.js"
import { resonatorShape } from "./resonator.js"
import { tactShape } from "./tact.js"
import type { UnoFamily } from "./uno-family.js"
import { usbBShape } from "./usbb.js"
import { usbCShape } from "./usbc.js"

export const UNO_SHAPES: Record<UnoFamily, (input: ShapeInput) => Piece[]> = {
  usbb: usbBShape,
  usbc: usbCShape,
  dcjack: dcJackShape,
  tact: tactShape,
  resonator: resonatorShape,
  inductor: inductorShape,
}
