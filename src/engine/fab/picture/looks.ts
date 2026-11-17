// The looks a board can be ordered in, as the picture paints them: the makers' usual solder mask colours, the print's
// two colours and the two copper finishes. Each colour is copperflow's own choice, picked by eye to read clearly on a
// screen; a board in the hand varies with the maker, the batch and the light.

/** Red, green, blue, 0 to 255. */
export type Rgb = readonly [number, number, number]

export interface MaskLook {
  name: string
  sentence: string
  /** Over bare laminate. */
  over: Rgb
  /** Over copper: the mask is thin there and the copper shows through it. */
  onCopper: Rgb
  /** How much of what lies under the mask tints it, 0 to 1. */
  see: number
  /** How strongly the mask catches the light, 0 (matte) to 1. */
  gloss: number
}

export interface InkLook {
  name: string
  sentence: string
  colour: Rgb
}

export interface FinishLook {
  name: string
  sentence: string
  face: Rgb
  /** The rim, where the finish runs down the copper's edge. */
  rim: Rgb
  shine: Rgb
}

export const MASKS = {
  green: { name: "green mask", sentence: "The common solder mask: deep green, lighter where copper lies under it.", over: [18, 82, 44], onCopper: [56, 132, 66], see: 0.1, gloss: 0.6 },
  black: { name: "black mask", sentence: "Glossy black; copper under it shows only as a faint sheen.", over: [20, 21, 23], onCopper: [40, 42, 44], see: 0.04, gloss: 0.9 },
  "matte-black": { name: "matte black mask", sentence: "Black without gloss; the copper under it barely shows.", over: [33, 33, 34], onCopper: [43, 43, 44], see: 0.02, gloss: 0.1 },
  blue: { name: "blue mask", sentence: "Medium blue, lighter over copper.", over: [16, 52, 122], onCopper: [44, 92, 168], see: 0.08, gloss: 0.6 },
  red: { name: "red mask", sentence: "Deep red, lighter over copper.", over: [146, 22, 30], onCopper: [190, 56, 52], see: 0.08, gloss: 0.6 },
  white: { name: "white mask", sentence: "White; copper under it reads as a pale warm tint. Its print is black by default.", over: [232, 233, 229], onCopper: [242, 238, 222], see: 0.06, gloss: 0.4 },
  yellow: { name: "yellow mask", sentence: "Strong yellow, paler over copper.", over: [212, 176, 28], onCopper: [232, 204, 78], see: 0.06, gloss: 0.5 },
  purple: { name: "purple mask", sentence: "Dark purple, lighter over copper.", over: [70, 30, 108], onCopper: [106, 62, 152], see: 0.08, gloss: 0.6 },
} as const satisfies Record<string, MaskLook>

export const SILKS = {
  white: { name: "white print", sentence: "The usual legend ink.", colour: [244, 244, 238] },
  black: { name: "black print", sentence: "Dark legend ink, for a white or yellow mask.", colour: [24, 24, 26] },
} as const satisfies Record<string, InkLook>

export const FINISHES = {
  enig: { name: "ENIG", sentence: "Immersion gold over nickel: flat and gold.", face: [212, 170, 78], rim: [150, 110, 44], shine: [246, 214, 132] },
  hasl: { name: "HASL", sentence: "Hot-air levelled solder: silver grey, a little domed.", face: [190, 193, 198], rim: [124, 127, 132], shine: [236, 238, 242] },
} as const satisfies Record<string, FinishLook>

/** The board's glass-fibre laminate where light comes through it, and where copper on the far side blocks the light. */
export const LAMINATE = { lit: [196, 178, 120] as Rgb, shaded: [150, 132, 82] as Rgb }
/** The wall of a plated hole, seen down the hole. */
export const BARREL: Rgb = [70, 62, 46]

export type MaskName = keyof typeof MASKS
export type SilkName = keyof typeof SILKS
export type FinishName = keyof typeof FINISHES

export const MASK_NAMES = Object.keys(MASKS) as MaskName[]
export const SILK_NAMES = Object.keys(SILKS) as SilkName[]
export const FINISH_NAMES = Object.keys(FINISHES) as FinishName[]

/** The look asked for; each part left out is the default: green mask, white print (black on a white mask), ENIG, no background. */
export interface LookRequest {
  mask?: MaskName
  silk?: SilkName
  finish?: FinishName
  /** A colour behind the board, "#rrggbb"; transparent when left out. */
  background?: string
}

export interface Look {
  mask: MaskName
  silk: SilkName
  finish: FinishName
  background?: Rgb
}

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i

/** The full look from a request; a name or colour that is not known is refused, naming the choices. */
export function resolveLook(request: LookRequest = {}): Look {
  const mask = request.mask ?? "green"
  if (!(mask in MASKS)) throw new Error(`mask must be one of ${MASK_NAMES.join(", ")}`)
  const silk = request.silk ?? (mask === "white" ? "black" : "white")
  if (!(silk in SILKS)) throw new Error(`silk must be one of ${SILK_NAMES.join(", ")}`)
  const finish = request.finish ?? "enig"
  if (!(finish in FINISHES)) throw new Error(`finish must be one of ${FINISH_NAMES.join(", ")}`)
  if (request.background === undefined) return { mask, silk, finish }
  const hex = HEX.exec(request.background)
  if (!hex) throw new Error('background must be a colour written "#rrggbb"')
  return { mask, silk, finish, background: [1, 2, 3].map((i) => parseInt(hex[i] as string, 16)) as unknown as Rgb }
}

/** "green mask, ENIG", the print named only when it is not the mask's usual one. */
export function lookWords(look: Look): string {
  const usual = look.mask === "white" ? "black" : "white"
  return [MASKS[look.mask].name, FINISHES[look.finish].name, ...(look.silk === usual ? [] : [SILKS[look.silk].name])].join(", ")
}
