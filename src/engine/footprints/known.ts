// What copperflow can make, for the refusal of a string it cannot: the string forms on one line, and the nearest
// valid strings when the refused one looks like a known family with a bad number or suffix. Pure.
import { DUAL_FORMS } from "./dual.js"
import { parseFootprint, type ParsedFootprint } from "./parse.js"

/** The dual series merged by form: "msop<N>" has one entry per pin count in `DUAL_FORMS`, the line names it once. */
const DUAL_LINES = DUAL_FORMS.reduce<{ form: string; pins: number[] }[]>((lines, { form, pins }) => {
  const line = lines.find((other) => other.form === form)
  if (line) line.pins.push(...pins)
  else lines.push({ form, pins: [...pins] })
  return lines
}, []).map(({ form, pins }) => `${form} (N ${pinList(pins.sort((a, b) => a - b))})`)

/** The string forms, one compact line. */
export const KNOWN_FORMS = [
  "chips 01005 0201 0402 0603 0805 1206 1210 1812 2010 2220 2512",
  "sod123 sod123f sod323 sod523 sod923 sod128, minimelf (sod80, do213aa), melf (do213ab)",
  "sma smb smc (do214ac do214aa do214ab)",
  "sot23 sot23_5 sot23_6 sot23_8 sot143 sot223 sot89",
  "sot323 sot353 sot363 (sc70 sc70_5 sc70_6) sot523 sot563 sot723",
  "tant_a … tant_e (tant3216 tant3528 tant6032 tant7343)",
  ...DUAL_LINES,
  "soic8_ep<w>x<h> msop8_ep<w>x<h> msop10_ep<w>x<h> tssop<N>_ep<w>x<h>",
  "array4x0603 array4x0402 array2x0402",
  "dpak d2pak d2pak_5 d2pak_7 (to252 to263 to263_5 to263_7)",
  "qfp32 qfp48 qfp64 qfp100, qfp<N>_<b>x<b>_p<pitch> (lqfp, tqfp)",
  "qfn16 qfn32 qfn48 with _ep, qfn<N>_<b>x<b>_p<pitch>[_ep<size>]",
  "dfn<N>_<a>x<b>_p<pitch>",
  "bga<N>_<x>x<y>_p<pitch>",
  "plcc<N> (N 20, 28, 32, 44, 52, 68, 84)",
  "smdip<N> (N 4, 6, 8, 16)",
  "dip<N>[_w<spacing>]",
  "to220 to220_2 to220_5 to247 to126 to92",
  "axial<length>x<spacing>[_d<diameter>] do35 do41 do15 do201ad",
  "led3mm led5mm led3528 led5050 led5050_6",
  "radial<can>x<spacing>",
  "smdcan<can>x<height> (4x5.4 5x5.4 6.3x5.4 6.3x7.7 8x6.5 8x10.2 10x10.2)",
  "xtal2016 xtal2520 xtal3225 xtal5032 xtal5032_2 xtal3215 xtal7050 hc49smd hc49 hc49s",
  "pinrow<N>[_p<pitch>] pinrow2x<N>",
  "socket<N> socket2x<N>",
  "screw<N>[_p3.5|3.81|5|5.08] (N 2–24)",
  "resonator3213 usb_b usb_c16 dcjack (dcjack2.1 dcjack2.5) tact6x6 tact6x6_smd",
  "ind<a>x<a> (4x4 5x5 6x6 8x8 10x10 12x12)",
].join("; ")

function pinList(pins: readonly number[]): string {
  const evenRun = pins.length > 2 && pins.every((n, i) => i === 0 || n - (pins[i - 1] ?? 0) === 2)
  return evenRun ? `even ${pins[0]}–${pins[pins.length - 1]}` : pins.join(", ")
}

const CHIPS = ["01005", "0201", "0402", "0603", "0805", "1206", "1210", "1812", "2010", "2220", "2512"]
const range = (from: number, to: number, step: number) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step)

/**
 * Valid strings grouped by the kind a string parses to, for the nearest ones. Strings that differ from
 * another only by a variant ("sot23_5", "d2pak_5", "led5050_6", "xtal5032_2") are left out: a variant is not a
 * number to be near to. `tant_a` is kind "tant" with no code; see `tag`.
 */
const CANDIDATES: readonly string[] = [
  ...CHIPS,
  "sod123",
  "sod123f",
  "sod323",
  "sod523",
  "sod923",
  "sod128",
  "sod80",
  "minimelf",
  "melf",
  "sot23",
  "sot143",
  "sot223",
  "sot89",
  "sot323",
  "sot353",
  "sot363",
  "sot523",
  "sot563",
  "sot723",
  "sc70",
  "do214ac",
  "do214aa",
  "do214ab",
  "do213aa",
  "do213ab",
  "do35",
  "do41",
  "do15",
  "do201ad",
  ...["a", "b", "c", "d", "e"].map((letter) => `tant_${letter}`),
  "tant3216",
  "tant3528",
  "tant6032",
  "tant7343",
  ...DUAL_FORMS.flatMap(({ form, pins }) => pins.map((n) => form.replace("<N>", String(n)))),
  "array4x0603",
  "array4x0402",
  "array2x0402",
  "dpak",
  "d2pak",
  "to252",
  "to263",
  ...["qfp", "lqfp", "tqfp"].flatMap((kind) => [32, 48, 64, 100].map((n) => `${kind}${n}`)),
  ...[16, 32, 48].map((n) => `qfn${n}`),
  ...[20, 28, 32, 44, 52, 68, 84].map((n) => `plcc${n}`),
  ...[4, 6, 8, 16].map((n) => `smdip${n}`),
  ...range(4, 64, 2).map((n) => `dip${n}`),
  "to220",
  "to220_2",
  "to220_5",
  "to247",
  "to126",
  "to92",
  "hc49",
  "hc49s",
  "hc49smd",
  "led3mm",
  "led5mm",
  "led3528",
  "led5050",
  ...["4x5.4", "5x5.4", "6.3x5.4", "6.3x7.7", "8x6.5", "8x10.2", "10x10.2"].map((size) => `smdcan${size}`),
  "xtal2016",
  "xtal2520",
  "xtal3225",
  "xtal5032",
  "xtal3215",
  "xtal7050",
  ...range(1, 40, 1).map((n) => `pinrow${n}`),
  ...range(1, 40, 1).map((n) => `socket${n}`),
  "socket2x5",
  ...range(2, 24, 1).map((n) => `screw${n}`),
  "resonator3213",
  "dcjack2.1",
  "dcjack2.5",
  "tact6x6",
  ...[4, 5, 6, 8, 10, 12].map((n) => `ind${n}x${n}`),
]

/** How many nearest strings a refusal names. */
const NEAREST = 3
/** A different suffix ("soic18" against "soic18w") counts as this many pins away. */
const SUFFIX_DISTANCE = 3

interface Candidate {
  text: string
  kind: string
  number: number
  cross: number
  suffix: string
}

/**
 * What a string is near to: its kind, a number to measure distance by, and the second size of "6.3x5.4" or
 * "4x0603". A string with no code and one bare letter ("tant_a") is a different kind of its own ("tant_"), whose
 * number is the letter's place in the alphabet, so "tant_f" is near "tant_e" and never near "tant3216".
 */
function placeOf(parsed: ParsedFootprint): Omit<Candidate, "text"> {
  const suffix = parsed.suffix ?? ""
  const cross = Number(parsed.cross ?? 0)
  const letters = Object.keys(parsed.params)
  const letter = parsed.code === "" && letters.length === 1 && letters[0]?.length === 1 ? letters[0] : undefined
  if (letter !== undefined) return { kind: `${parsed.kind}_`, number: letter.charCodeAt(0) - 96, cross, suffix }
  return { kind: parsed.kind, number: Number(parsed.code || 0), cross, suffix }
}

const PARSED: readonly Candidate[] = CANDIDATES.flatMap((text) => {
  const parsed = parseFootprint(text)
  return parsed ? [{ text, ...placeOf(parsed) }] : []
})

/** The valid strings nearest to one of a known kind, by suffix then by number; none when the kind is unknown. */
export function nearestFootprints(text: string): string[] {
  const parsed = parseFootprint(text)
  if (!parsed) return []
  const here = placeOf(parsed)
  const score = (c: Candidate) => (c.suffix === here.suffix ? 0 : SUFFIX_DISTANCE) + Math.abs(c.number - here.number) + Math.abs(c.cross - here.cross)
  return PARSED.filter((c) => c.kind === here.kind)
    .sort((a, b) => score(a) - score(b) || a.number - b.number || a.cross - b.cross || a.text.localeCompare(b.text))
    .slice(0, NEAREST)
    .sort((a, b) => a.number - b.number || a.cross - b.cross || a.text.localeCompare(b.text))
    .map((c) => c.text)
}

/** The refusal for a string no family accepts. */
export function unknownFootprint(text: string): string {
  const nearest = nearestFootprints(text)
  const near = nearest.length > 0 ? ` nearest are ${nearest.join(", ")};` : ""
  return `copperflow cannot make footprint "${text}":${near} known families are ${KNOWN_FORMS} (see the skill's parts library reference)`
}
