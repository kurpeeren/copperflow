// Electrical values as a part writes them ("4.7k", "100nF", "3.3V", "48mohm") and as the simulator's answer shows
// them ("3.41 V", "29.6 mA"): SI prefixes, case-sensitive (m is milli, M is mega), units ignored on reading.

const PREFIX: Readonly<Record<string, number>> = { p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 }
const VALUE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([pnuµmkKMG]?)\s*(V|A|W|F|H|Hz|Ω|ohm|ohms|R)?$/

/** A number from 120, "120", "4.7k", "100nF" or "2mA"; undefined when it is not one. */
export function parseQuantity(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value !== "string") return undefined
  const match = VALUE.exec(value.trim())
  if (!match) return undefined
  const result = Number(match[1]) * (PREFIX[match[2] ?? ""] ?? 1)
  return Number.isFinite(result) ? result : undefined
}

const SHOWN: readonly [number, string][] = [
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
  [1, ""],
  [1e-3, "m"],
  [1e-6, "µ"],
  [1e-9, "n"],
  [1e-12, "p"],
]

/** Below this a figure is shown as 0: the small conductance to ground leaves currents of femtoamps. */
const SHOWN_ZERO = 1e-13

/** `3.41 V`, `29.6 mA`, `355 mW`: three significant digits and a prefix. */
export function formatQuantity(value: number, unit: string): string {
  if (!Number.isFinite(value)) return `${value} ${unit}`
  if (Math.abs(value) < SHOWN_ZERO) return `0 ${unit}`
  const size = Math.abs(Number(value.toPrecision(3)))
  const [scale, prefix] = SHOWN.find(([step]) => size >= step) ?? [1e-12, "p"]
  const digits = (value / scale).toPrecision(3)
  return `${digits.includes("e") ? Number(digits).toString() : digits} ${prefix}${unit}`
}
