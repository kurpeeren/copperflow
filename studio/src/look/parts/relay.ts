// A PCB relay drawn from its library footprint: a dark plinth on the board, the case on it with its top edges
// chamfered, and its part number printed on the top along its length. The part's `color` paints the case; clear makes
// it see-through, showing the works inside as on the common clear-cased relays: the coil (a copper winding between
// two black bobbin flanges) at the end of the coil pins, the metal yoke over it, and a contact blade over each contact
// pin at the other end; the part number then sits on a black label. A lead goes through each hole. Pure.
import { leads, type ShapeInput } from "./input.js"
import { box, circle, clipped, frustum, grown, lying, turnPieces, type Piece, type Rect } from "./kit.js"
import { LIFT, lidPrint } from "./sleeve-print.js"
import type { Rgb } from "../scene.js"

/** The plinth's height and how far the case stands inside it, the chamfer round the top, and the outline inset. */
const PLINTH = 0.6
const PLINTH_INSET = 0.15
const CHAMFER = 0.5
const INSET = 0.15
/** The printed text keeps this share of the top's length and width. */
const PRINT_SHARE = 0.8
const PLINTH_COLOR: Rgb = [30, 30, 33]
const INK: Rgb = [232, 234, 236]

/** The case colours a part's `color` may name (side, top); clear is drawn see-through. */
const CASE_COLORS = new Map<string, readonly [Rgb, Rgb]>([
  ["black", [[30, 30, 33], [40, 40, 44]]],
  ["white", [[226, 226, 222], [238, 238, 234]]],
  ["grey", [[128, 130, 134], [146, 148, 152]]],
  ["blue", [[46, 86, 156], [58, 100, 170]]],
  ["red", [[184, 40, 36], [204, 58, 52]]],
  ["green", [[44, 128, 78], [58, 146, 92]]],
  ["yellow", [[226, 190, 40], [240, 208, 70]]],
])
/** A clear case: a faint cool tint, and how much of the colour behind it shows (1 − this). */
const CLEAR_TINT: Rgb = [214, 224, 232]
const CLEAR_ALPHA = 0.28
/** The works inside a clear case: wall clearance, the coil's share of the length, the winding's radius as a share of
 * the width, a bobbin flange's thickness, the yoke's thickness, a contact blade's thickness and its share of the height. */
const WALL = 0.7
const COIL_SHARE = 0.55
const WINDING_SHARE = 0.34
const FLANGE = 0.8
const YOKE = 0.7
const BLADE = 0.35
const BLADE_SHARE = 0.72
const COPPER: Rgb = [184, 104, 52]
const BOBBIN: Rgb = [28, 28, 30]
const STEEL: Rgb = [150, 154, 160]
const LABEL: Rgb = [22, 22, 24]

const named = (props: ShapeInput["props"], key: string): string | undefined => {
  const value = props?.[key]
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
}

/** The part number to print, when the part has one. */
const printed = (props: ShapeInput["props"]): string[] => {
  const mpn = named(props, "manufacturerPartNumber")
  return mpn === undefined ? [] : [mpn]
}

/** Which way along its length the coil end lies (+1 or −1): the side of the widest gap between rows with fewer rows. */
function coilSide(rows: readonly number[]): 1 | -1 {
  const sorted = [...new Set(rows.map((r) => Math.round(r * 1000) / 1000))].sort((a, b) => a - b)
  if (sorted.length < 2) return 1
  let at = 0
  sorted.slice(1).forEach((r, i) => {
    if (r - (sorted[i] as number) > (sorted[at + 1] as number) - (sorted[at] as number)) at = i
  })
  return at + 1 <= sorted.length - (at + 1) ? -1 : 1
}

/**
 * The works inside a clear case, drawn with the length along +y (x across), from `room` (the inside of the case):
 * the coil at the `coil` end, blades over the contact `columns` at the other end.
 */
function works(room: Rect, top: number, coil: 1 | -1, columns: readonly number[]): Piece[] {
  const length = room.maxY - room.minY
  const width = room.maxX - room.minX
  const [near, far] = coil === 1 ? [room.maxY, room.maxY - length * COIL_SHARE] : [room.minY, room.minY + length * COIL_SHARE]
  const [y0, y1] = [Math.min(near, far), Math.max(near, far)]
  const cx = (room.minX + room.maxX) / 2
  const radius = Math.min(width * WINDING_SHARE, (top - PLINTH) * 0.4)
  const axis = PLINTH + radius + 0.3
  // The winding lies along y: draw it along x and turn it a quarter.
  const winding = turnPieces(lying(circle(-cx, axis, radius, 16), y0 + FLANGE, y1 - FLANGE, COPPER, "metal", "body"), 90)
  const flanges = [y0, y1 - FLANGE].flatMap((y) => box({ minX: cx - radius - 0.4, maxX: cx + radius + 0.4, minY: y, maxY: y + FLANGE }, PLINTH, axis + radius + 0.4, BOBBIN, "matt", "body"))
  const yoke = box({ minX: cx - radius * 0.6, maxX: cx + radius * 0.6, minY: y0, maxY: y1 }, axis + radius + 0.4, axis + radius + 0.4 + YOKE, STEEL, "metal", "body")
  const [b0, b1] = coil === 1 ? [room.minY + 0.4, far - 0.6] : [far + 0.6, room.maxY - 0.4]
  const bladeTop = PLINTH + (top - PLINTH) * BLADE_SHARE
  const blades = columns.flatMap((x) => box({ minX: x - BLADE / 2, maxX: x + BLADE / 2, minY: b0, maxY: b1 }, PLINTH, bladeTop, STEEL, "metal", "body"))
  return [...winding, ...flanges, ...yoke, ...blades]
}

export function relayShape(input: ShapeInput): Piece[] {
  const outline: Rect = clipped(input.body ?? grown(input.limit, -INSET), input.limit)
  const lines = printed(input.props)
  const color = named(input.props, "color")?.toLowerCase()
  const clear = color === "clear"
  const paint = color === undefined ? undefined : CASE_COLORS.get(color)
  const side = clear ? CLEAR_TINT : (paint?.[0] ?? input.look.body)
  const topColor = clear ? CLEAR_TINT : (paint?.[1] ?? input.look.top ?? input.look.body)
  // The print stands a hair proud of the top, so the top sits that much lower and the part keeps its height.
  const h = Math.max(input.height, PLINTH + CHAMFER * 2) - (lines.length > 0 ? LIFT * (clear ? 2 : 1) : 0)
  const chamfer = Math.min(CHAMFER, (outline.maxX - outline.minX) / 4, (outline.maxY - outline.minY) / 4)
  const caseRect = grown(outline, -PLINTH_INSET)
  const shoulder = h - chamfer
  const top = grown(caseRect, -chamfer)
  const shell: Piece[] = [
    ...box(caseRect, PLINTH, shoulder, { top: topColor, side }, "matt", "body").filter((piece) => piece.normal[2] < 0.99),
    ...frustum(caseRect, top, shoulder, h, { top: topColor, side }, "matt", "body"),
  ]
  const along = top.maxY - top.minY >= top.maxX - top.minX
  const [length, width] = along ? [top.maxY - top.minY, top.maxX - top.minX] : [top.maxX - top.minX, top.maxY - top.minY]
  const at = { x: (top.minX + top.maxX) / 2, y: (top.minY + top.maxY) / 2 }
  const inside: Piece[] = []
  const label: Piece[] = []
  if (clear) {
    // The works are drawn with the length along y; a relay lying along x has its pads turned into that frame and back.
    const room = grown(caseRect, -WALL)
    const turned = along ? room : { minX: room.minY, maxX: room.maxY, minY: -room.maxX, maxY: -room.minX }
    const pads = input.pads.map((pad) => (along ? { u: pad.y, v: pad.x } : { u: -pad.x, v: pad.y }))
    const coil = coilSide(pads.map((p) => p.u))
    const coilRow = coil === 1 ? Math.max(...pads.map((p) => p.u)) : Math.min(...pads.map((p) => p.u))
    const columns = [...new Set(pads.filter((p) => Math.abs(p.u - coilRow) > 1e-3).map((p) => Math.round(p.v * 1000) / 1000))]
    const drawn = works(turned, h, coil, columns)
    inside.push(...(along ? drawn : turnPieces(drawn, 90)))
    if (lines.length > 0) {
      const plate = along ? { minX: at.x - width * 0.42, maxX: at.x + width * 0.42, minY: at.y - length * 0.42, maxY: at.y + length * 0.42 } : { minX: at.x - length * 0.42, maxX: at.x + length * 0.42, minY: at.y - width * 0.42, maxY: at.y + width * 0.42 }
      label.push(...box(plate, h, h + LIFT, LABEL, "matt", "body").filter((piece) => piece.normal[2] > 0.99))
    }
  }
  const printZ = clear && lines.length > 0 ? h + LIFT : h
  const print = lidPrint(at, length * PRINT_SHARE * (clear ? 0.9 : 1), width * PRINT_SHARE * (clear ? 0.9 : 1), printZ, lines, INK, along)
  const caseFaces = clear ? shell.map((piece) => ({ ...piece, alpha: CLEAR_ALPHA })) : shell
  return [...box(outline, 0, PLINTH, PLINTH_COLOR, "matt", "body"), ...inside, ...caseFaces, ...label, ...print, ...leads(input)]
}
