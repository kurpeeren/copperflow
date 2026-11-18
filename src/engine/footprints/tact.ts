import { holePad } from "./connector.js"
import { roundRectPad } from "./ipc7351.js"
import { closedRectangle, courtyard, pinOneTick, tidy } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import { clearOutline, FIXED_LAND_COURTYARD, tickBelow } from "./smdbox.js"
import { refuse, type Footprint, type Pad, type Refusal } from "./types.js"

/**
 * 6 × 6 mm tact switches: "tact6x6" (through-hole) and "tact6x6_smd" (four gull-wing terminals). Four pads at the
 * corners: 1 top left, 2 top right, 3 bottom left, 4 bottom right. Pads 1 and 2 are joined inside the switch (one
 * contact), and so are 3 and 4 (the other); pressing joins the two pairs. Würth numbers the same corners 1, 3, 2, 4
 * (its 1–3 and 2–4 are joined): copperflow's 2 is its 3, copperflow's 3 its 2.
 *
 * tact6x6, cited: Würth Elektronik 430186043716, "WS-TATV THT Tact Switch", revision 004.001, 2022-03-02, page 1,
 * "Recommended Hole Pattern": ⌀1.0 holes 6.5 apart along the joined pairs and 4.5 across; body 6.2 square.
 * https://www.we-online.com/components/products/datasheet/430186043716.pdf
 * tact6x6_smd, cited: Würth Elektronik 430182043816, "WS-TASV SMT Tact Switch", revision 002.002, 2020-06-04,
 * page 1, "Recommended Land Pattern": lands 1.3 high, 6.4 apart inside and 9.5 over the pair (so 1.55 long), 4.5
 * across; body 6.2 square. https://www.we-online.com/components/products/datasheet/430182043816.pdf
 * Lands of the through-hole part are the hole + 0.6 mm (connector.ts). These are that maker's parts: another maker's
 * 6 × 6 switch may need different holes or lands.
 */
const BODY = { x: 3.1, y: 3.1 }
const ACROSS = 2.25
const THT = { half: 3.25, hole: 1 }
const SMD = { inside: 6.4, over: 9.5, height: 1.3 }
/** The through-hole pin 1 tick sits this far beyond the body outline. */
const TICK_GAP = 0.3

const corners = (half: number): [number, number][] => [[-half, ACROSS], [half, ACROSS], [-half, -ACROSS], [half, -ACROSS]]

function throughHole(): Footprint {
  const pads = corners(THT.half).map(([x, y], i) => holePad(String(i + 1), x, y, THT.hole, i === 0))
  const outline = closedRectangle(BODY)
  const tickY = tidy(BODY.y + TICK_GAP)
  return {
    name: "tact6x6",
    pads,
    courtyard: courtyard(pads, { x: BODY.x, y: tickY }, FIXED_LAND_COURTYARD),
    silkscreen: [...clearOutline(outline, pads), pinOneTick(pads[0] as Pad, tickY)],
    fabrication: [outline],
    origin: "Tact switch 6 × 6 mm, through-hole: holes from Würth Elektronik 430186043716 recommended hole pattern; that maker's part, others may differ",
  }
}

function surface(): Footprint {
  const length = tidy((SMD.over - SMD.inside) / 2)
  const pads = corners(tidy((SMD.inside + length) / 2)).map(([x, y], i) => roundRectPad(String(i + 1), x, y, length, SMD.height))
  const outline = closedRectangle(BODY)
  return {
    name: "tact6x6_smd",
    pads,
    courtyard: courtyard(pads, BODY, FIXED_LAND_COURTYARD),
    silkscreen: [...clearOutline(outline, pads), tickBelow(pads, pads[2] as Pad).map((p) => ({ x: p.x, y: -p.y }))],
    fabrication: [outline],
    origin: "Tact switch 6 × 6 mm, surface-mount: lands from Würth Elektronik 430182043816 recommended land pattern; that maker's part, others may differ",
  }
}

export function tactFootprint(parsed: ParsedFootprint): Footprint | Refusal | undefined {
  if (parsed.kind !== "tact") return undefined
  const keys = Object.keys(parsed.params)
  const six = parsed.code === "6" && parsed.cross === "6" && parsed.suffix === undefined && parsed.variant === undefined && parsed.size === undefined && parsed.pairs === undefined
  if (six && keys.length === 0) return throughHole()
  if (six && keys.length === 1 && parsed.params["smd"] === true) return surface()
  return refuse("tact switches are tact6x6 (through-hole) and tact6x6_smd")
}
