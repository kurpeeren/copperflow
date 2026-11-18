// A paint's colour as ink or clear. A drawing is made on a board in one colour, so a light shape over a dark one is
// read as a gap in it (the way a logo is usually drawn: a black disc, then a white letter on top). Lightness is the
// sRGB colour's luma (Rec. 709 weights on the 0..1 channels); above LIGHT_THRESHOLD the paint is clear.

/** Luma above which a paint is light, and so clear. */
export const LIGHT_THRESHOLD = 0.5

export type Tone = "ink" | "clear"

/** A colour as read: its tone, or `none` for no paint, or `unread` (drawn as ink and counted). */
export type ReadColour = { tone: Tone } | "none" | "unread"

const LUMA = { r: 0.2126, g: 0.7152, b: 0.0722 } as const
const CHANNEL_MAX = 255
const PERCENT = 100

/** Named colours read, as 0..255 channels; anything else named is not read. */
const NAMED: Record<string, readonly [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  currentcolor: [0, 0, 0],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  darkgray: [169, 169, 169],
  darkgrey: [169, 169, 169],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
  red: [255, 0, 0],
  lime: [0, 255, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  aqua: [0, 255, 255],
  magenta: [255, 0, 255],
  fuchsia: [255, 0, 255],
  maroon: [128, 0, 0],
  navy: [0, 0, 128],
  olive: [128, 128, 0],
  purple: [128, 0, 128],
  teal: [0, 128, 128],
  orange: [255, 165, 0],
}

const toneOf = (r: number, g: number, b: number): ReadColour => {
  const luma = (LUMA.r * r + LUMA.g * g + LUMA.b * b) / CHANNEL_MAX
  return { tone: luma > LIGHT_THRESHOLD ? "clear" : "ink" }
}

function hexColour(hex: string): ReadColour {
  const digits = hex.length === 3 || hex.length === 4 ? [...hex.slice(0, 3)].map((d) => d + d) : hex.length === 6 || hex.length === 8 ? [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)] : undefined
  if (!digits || !/^[0-9a-f]+$/.test(hex)) return "unread"
  const [r, g, b] = digits.map((d) => parseInt(d, 16)) as [number, number, number]
  return toneOf(r, g, b)
}

function channel(text: string): number | undefined {
  const value = text.trim()
  const number = Number(value.endsWith("%") ? value.slice(0, -1) : value)
  if (value === "" || !Number.isFinite(number)) return undefined
  const scaled = value.endsWith("%") ? (number * CHANNEL_MAX) / PERCENT : number
  return Math.min(CHANNEL_MAX, Math.max(0, scaled))
}

function rgbColour(inner: string): ReadColour {
  const parts = inner.split(/[\s,/]+/).filter((p) => p !== "")
  if (parts.length < 3 || parts.length > 4) return "unread"
  const channels = parts.slice(0, 3).map(channel)
  if (channels.some((c) => c === undefined)) return "unread"
  const [r, g, b] = channels as [number, number, number]
  return toneOf(r, g, b)
}

/** A fill or stroke value's colour. `url(…)` paints are left to the caller. */
export function readColour(value: string): ReadColour {
  const text = value.trim().toLowerCase()
  if (text === "none" || text === "transparent") return "none"
  if (text.startsWith("#")) return hexColour(text.slice(1))
  const rgb = text.match(/^rgba?\((.*)\)$/)
  if (rgb) return rgbColour(rgb[1] as string)
  const named = NAMED[text]
  return named ? toneOf(...named) : "unread"
}

/** An opacity value is zero ("0", "0%", "0.0"); anything else, or nothing, draws. */
export function isZeroOpacity(value: string | undefined): boolean {
  if (value === undefined) return false
  const text = value.trim()
  const number = Number(text.endsWith("%") ? text.slice(0, -1) : text)
  return text !== "" && Number.isFinite(number) && number <= 0
}
