// What copperflow can make, for the refusal of a string it cannot: the string forms on one line, and the nearest
// valid strings when the refused one looks like a known family with a bad number or suffix. Pure.
import { DUAL_FORMS } from "./dual.js"
import { parseFootprint } from "./parse.js"

/** The string forms, one compact line. */
export const KNOWN_FORMS = [
  "chips 0201 0402 0603 0805 1206 1210 1812 2010 2512",
  "sod123 sod323",
  "sma smb smc (do214ac do214aa do214ab)",
  "sot23 sot23_5 sot23_6 sot223 sot89",
  ...DUAL_FORMS.map(({ form, pins }) => `${form} (N ${pinList(pins)})`),
  "qfp32 qfp48 qfp64 qfp100, qfp<N>_<b>x<b>_p<pitch> (lqfp, tqfp)",
  "qfn16 qfn32 qfn48 with _ep, qfn<N>_<b>x<b>_p<pitch>[_ep<size>]",
  "dfn<N>_<a>x<b>_p<pitch>",
  "bga<N>_<x>x<y>_p<pitch>",
  "dip<N>[_w<spacing>]",
  "to220 to92 hc49 hc49s",
  "radial<can>x<spacing>",
  "pinrow<N>[_p<pitch>] pinrow2x<N>",
].join("; ")

function pinList(pins: readonly number[]): string {
  const evenRun = pins.length > 2 && pins.every((n, i) => i === 0 || n - (pins[i - 1] ?? 0) === 2)
  return evenRun ? `even ${pins[0]}–${pins[pins.length - 1]}` : pins.join(", ")
}

const CHIPS = ["0201", "0402", "0603", "0805", "1206", "1210", "1812", "2010", "2512"]
const range = (from: number, to: number, step: number) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step)

/** Valid strings grouped by the kind a string parses to, for the nearest ones. */
const CANDIDATES: readonly string[] = [
  ...CHIPS,
  "sod123",
  "sod323",
  "sot23",
  "sot223",
  "sot89",
  "do214ac",
  "do214aa",
  "do214ab",
  ...DUAL_FORMS.flatMap(({ form, pins }) => pins.map((n) => form.replace("<N>", String(n)))),
  ...["qfp", "lqfp", "tqfp"].flatMap((kind) => [32, 48, 64, 100].map((n) => `${kind}${n}`)),
  ...[16, 32, 48].map((n) => `qfn${n}`),
  ...range(4, 64, 2).map((n) => `dip${n}`),
  "to220",
  "to92",
  "hc49",
  "hc49s",
  ...range(1, 40, 1).map((n) => `pinrow${n}`),
]

/** How many nearest strings a refusal names. */
const NEAREST = 3
/** A different suffix ("soic18" against "soic18w") counts as this many pins away. */
const SUFFIX_DISTANCE = 3

interface Candidate {
  text: string
  kind: string
  number: number
  suffix: string
}

const PARSED: readonly Candidate[] = CANDIDATES.flatMap((text) => {
  const parsed = parseFootprint(text)
  return parsed ? [{ text, kind: parsed.kind, number: Number(parsed.code || 0), suffix: parsed.suffix ?? "" }] : []
})

/** The valid strings nearest to one of a known kind, by suffix then by number; none when the kind is unknown. */
export function nearestFootprints(text: string): string[] {
  const parsed = parseFootprint(text)
  if (!parsed) return []
  const number = Number(parsed.code || 0)
  const suffix = parsed.suffix ?? ""
  const score = (c: Candidate) => (c.suffix === suffix ? 0 : SUFFIX_DISTANCE) + Math.abs(c.number - number)
  return PARSED.filter((c) => c.kind === parsed.kind)
    .sort((a, b) => score(a) - score(b) || a.number - b.number || a.text.localeCompare(b.text))
    .slice(0, NEAREST)
    .sort((a, b) => a.number - b.number || a.text.localeCompare(b.text))
    .map((c) => c.text)
}

/** The refusal for a string no family accepts. */
export function unknownFootprint(text: string): string {
  const nearest = nearestFootprints(text)
  const near = nearest.length > 0 ? ` nearest are ${nearest.join(", ")};` : ""
  return `copperflow cannot make footprint "${text}":${near} known families are ${KNOWN_FORMS} (see the skill's parts library reference)`
}
