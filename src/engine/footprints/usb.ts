import { holePad, matingArrow, slotPad } from "./connector.js"
import { roundRectPad } from "./ipc7351.js"
import { closedRectangle, courtyard, tidy } from "./outline.js"
import { isSimple, type ParsedFootprint } from "./parse.js"
import { clearOutline, FIXED_LAND_COURTYARD } from "./smdbox.js"
import { refuse, type Footprint, type Pad, type Refusal } from "./types.js"

/**
 * USB receptacles: "usb_b" (Type-B, through-hole, right-angle) and "usb_c16" (Type-C, 16 pins, USB 2.0, surface-mount
 * signal row with through-hole shell legs). Origin at the body centre; the plug enters from −y, marked on the
 * fabrication layer by an arrow pointing into the body.
 *
 * Pad numbers are digits because copperflow joins a pad to the pin of the same number ("pin5"); a pad named "S1" or
 * "A5" would never reach a net. The shell legs of each receptacle share one number, as a SOT-89's tab shares pin 2,
 * so the shield is one pin that can be tied to ground or left to a filter.
 *
 * usb_b, cited: Würth Elektronik 61400416121, "WR-COM USB 2.0 Horizontal THT", Type B, revision 001.003, 2024-01-30,
 * page 1, "Recommended Hole Pattern": signal holes ⌀0.92, pins 2 and 1 2.5 apart in the row furthest from the plug,
 * pins 3 and 4 below them 2.0 nearer the plug (3 under 2, 4 under 1), shell holes ⌀2.3 12.04 apart, 2.71 nearer the
 * plug than pins 3 and 4; body 12.04 wide, 16.5 deep, shell legs 10.28 from the mating face (side view).
 * https://www.we-online.com/components/products/datasheet/61400416121.pdf
 * Pins as the USB specification numbers them: 1 VBUS, 2 D−, 3 D+, 4 GND; pad 5 is the shell. Lands are the hole +
 * 0.6 mm (connector.ts). This is that maker's part: another maker's Type-B may need different holes.
 *
 * usb_c16, cited: Würth Elektronik 629722000214, "WR-COM USB 2.0 Horizontal Receptacle SMT", Type C 2.0, 16 pins,
 * revision 002.000, 2025-09-04, page 1, "Recommended Land Pattern": twelve pads 1.15 long, 0.3 wide at ±0.25, ±0.75,
 * ±1.25, ±1.75 and 0.6 wide at ±2.4 and ±3.2; shell slots 8.64 apart, the rear pair ⌀0.6 × 1.7 hole in a 1.0 × 2.1
 * land, the front pair ⌀0.6 × 1.4 in 1.0 × 1.8, 4.18 apart; the front slots 2.62 from the product edge, the far end
 * of the signal pads 5.32 from the front slots; body 8.94 × 7.53. The two ⌀0.65 holes for the plastic pegs are left
 * to the board outline (no copper). https://www.we-online.com/components/products/datasheet/629722000214.pdf
 * Seen from the top with the plug at the bottom, pads 1–12 left to right are the Type-C contacts A1/B12 (GND),
 * A4/B9 (VBUS), B8 (SBU2), A5 (CC1), B7 (D−), A6 (D+), A7 (D−), B6 (D+), A8 (SBU1), B5 (CC2), B4/A9 (VBUS),
 * B1/A12 (GND); pad 13 is the shell. This is that maker's part: another maker's 16-pin Type-C may need different
 * lands and shell legs. The same sheet's "Article Properties" recommends a 0.8 mm board for this part.
 */
export const USB_C16_CONTACTS: readonly string[] = ["A1/B12", "A4/B9", "B8", "A5", "B7", "A6", "A7", "B6", "A8", "B5", "B4/A9", "B1/A12"]

const B = {
  body: { x: 6.02, y: 8.25 },
  signalHole: 0.92,
  shellHole: 2.3,
  pinX: 1.25,
  shellX: 6.02,
  shellFromFront: 10.28,
  shellToRow: 2.71,
  rowGap: 2,
}

const C = {
  body: { x: 4.47, y: 3.765 },
  xs: [-3.2, -2.4, -1.75, -1.25, -0.75, -0.25, 0.25, 0.75, 1.25, 1.75, 2.4, 3.2],
  wide: 0.6,
  narrow: 0.3,
  length: 1.15,
  shellX: 4.32,
  frontFromEdge: 2.62,
  rearAboveFront: 4.18,
  padEndAboveFront: 5.32,
  rear: { land: { x: 1, y: 2.1 }, hole: { x: 0.6, y: 1.7 } },
  front: { land: { x: 1, y: 1.8 }, hole: { x: 0.6, y: 1.4 } },
}

function usbBPads(): Pad[] {
  const shellY = tidy(-B.body.y + B.shellFromFront)
  const near = shellY + B.shellToRow
  const far = near + B.rowGap
  return [
    holePad("1", B.pinX, far, B.signalHole, true),
    holePad("2", -B.pinX, far, B.signalHole),
    holePad("3", -B.pinX, near, B.signalHole),
    holePad("4", B.pinX, near, B.signalHole),
    holePad("5", -B.shellX, shellY, B.shellHole),
    holePad("5", B.shellX, shellY, B.shellHole),
  ]
}

function usbCPads(): Pad[] {
  const front = tidy(-C.body.y + C.frontFromEdge)
  const rear = tidy(front + C.rearAboveFront)
  const row = tidy(front + C.padEndAboveFront - C.length / 2)
  const signal = C.xs.map((x, i) => roundRectPad(String(i + 1), x, row, Math.abs(x) >= 2 ? C.wide : C.narrow, C.length))
  const shell = [
    slotPad("13", -C.shellX, rear, C.rear.land, C.rear.hole),
    slotPad("13", C.shellX, rear, C.rear.land, C.rear.hole),
    slotPad("13", -C.shellX, front, C.front.land, C.front.hole),
    slotPad("13", C.shellX, front, C.front.land, C.front.hole),
  ]
  return [...signal, ...shell]
}

function receptacle(name: string, pads: Pad[], body: { x: number; y: number }, origin: string): Footprint {
  const outline = closedRectangle(body)
  return {
    name,
    pads,
    courtyard: courtyard(pads, body, FIXED_LAND_COURTYARD),
    silkscreen: clearOutline(outline, pads),
    fabrication: [outline, ...matingArrow(-body.y)],
    origin,
  }
}

export function usbFootprint(parsed: ParsedFootprint): Footprint | Refusal | undefined {
  if (parsed.kind !== "usb") return undefined
  const keys = Object.keys(parsed.params)
  const plain = isSimple(parsed) && parsed.code === "" && parsed.variant === undefined && keys.length === 1
  if (plain && parsed.params["b"] === true) {
    return receptacle("usb_b", usbBPads(), B.body, "USB Type-B receptacle, through-hole, right-angle: holes from Würth Elektronik 61400416121 recommended hole pattern; that maker's part, others may differ")
  }
  if (plain && parsed.params["c"] === 16) {
    return receptacle("usb_c16", usbCPads(), C.body, "USB Type-C receptacle, 16 pins (USB 2.0): lands from Würth Elektronik 629722000214 recommended land pattern; that maker's part, others may differ")
  }
  return refuse("USB receptacles are usb_b and usb_c16")
}
