// A USB Type-B receptacle: a tinned metal shell on the footprint's body outline as tall as the part, open at the mating
// face (−y): a rectangular opening with a dark cavity behind it and a pale plastic tongue standing out of the cavity's
// back. Two flat shell legs and four round pins go through their holes. The front is four strips round the opening, so
// no face lies over another. Pure.
import { leads, type ShapeInput } from "./input.js"
import { clipped, grown, prism, rectPolygon, type Piece } from "./kit.js"
import { capY, frontRect, openBox, stripLeads, wallY } from "./uno-kit.js"

/** The opening's greatest size across and up, and its share of the shell's width and of the part's height. */
const OPENING = { across: 8.4, up: 7.8 }
const ACROSS_SHARE = 0.7
const UP_SHARE = 0.72
/** The cavity's depth at most, and its share of the shell's depth. */
const CAVITY_DEPTH = 9
const DEPTH_SHARE = 0.55
/** The tongue: its greatest width, length and thickness, and the shares of the opening and cavity they are of. */
const TONGUE = { across: 6.2, length: 6, thick: 1.5 }
const TONGUE_ACROSS_SHARE = 0.74
const TONGUE_LENGTH_SHARE = 0.7
const TONGUE_THICK_SHARE = 0.2
/** A hole wider than this is a shell leg's; a leg is a flat strip this half thick (x) and half wide (y). */
const SHELL_HOLE = 1.5
const LEG_HALF = { x: 0.2, y: 0.9 }

export function usbBShape(input: ShapeInput): Piece[] {
  const shell = clipped(input.body ?? grown(input.limit, -0.25), input.limit)
  const { look } = input
  const h = input.height
  const mid = (shell.minX + shell.maxX) / 2
  const [across, up] = [Math.min(OPENING.across, (shell.maxX - shell.minX) * ACROSS_SHARE), Math.min(OPENING.up, h * UP_SHARE)]
  const [x0, x1, z0, z1] = [mid - across / 2, mid + across / 2, (h - up) / 2, (h + up) / 2]
  const back = shell.minY + Math.min(CAVITY_DEPTH, (shell.maxY - shell.minY) * DEPTH_SHARE)
  const room = [{ x: x0, y: z0 }, { x: x1, y: z0 }, { x: x1, y: z1 }, { x: x0, y: z1 }]
  const tongue = { minX: mid - Math.min(TONGUE.across, across * TONGUE_ACROSS_SHARE) / 2, maxX: mid + Math.min(TONGUE.across, across * TONGUE_ACROSS_SHARE) / 2 }
  const thick = Math.min(TONGUE.thick, up * TONGUE_THICK_SHARE)
  const sides = prism(rectPolygon(shell), 0, h, look.metal, "metal", "body").filter((piece) => piece.normal[1] > -0.99)
  const front = [
    ...frontRect(shell.minX, x0, 0, h, shell.minY, -1, look.metal, "metal", "body"),
    ...frontRect(x1, shell.maxX, 0, h, shell.minY, -1, look.metal, "metal", "body"),
    ...frontRect(x0, x1, 0, z0, shell.minY, -1, look.metal, "metal", "body"),
    ...frontRect(x0, x1, z1, h, shell.minY, -1, look.metal, "metal", "body"),
  ]
  const cavity = [...wallY(room, shell.minY, back, look.mark, "matt", "body", "in"), capY(room, back, -1, look.mark, "matt", "body")]
  const plate = openBox(tongue, back - Math.min(TONGUE.length, (back - shell.minY) * TONGUE_LENGTH_SHARE), back, (h - thick) / 2, (h + thick) / 2, look.body, "matt", "body")
  const signal = leads({ ...input, pads: input.pads.filter((pad) => (pad.drill?.width ?? 0) <= SHELL_HOLE) }, look.metal)
  return [...sides, ...front, ...cavity, ...plate, ...signal, ...stripLeads(input, (pad) => (pad.drill?.width ?? 0) > SHELL_HOLE, look.metal, LEG_HALF)]
}
