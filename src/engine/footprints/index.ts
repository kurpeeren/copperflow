import { chipFootprint } from "./chip.js"
import { dualFootprint } from "./dual.js"
import { parseFootprint, type ParsedFootprint } from "./parse.js"
import { pinRowFootprint } from "./pinrow.js"
import { quadFootprint } from "./quad.js"
import { sodFootprint } from "./sod.js"
import { sotFootprint } from "./sot.js"
import type { Footprint } from "./types.js"

export type FootprintResult = Footprint | { error: string }

/** A footprint family: makes a footprint from a parsed string, or declines with undefined. */
type Family = (parsed: ParsedFootprint) => Footprint | undefined

/** No variant and no parameters: "0603", not "0603_5" or "0603_p0.5mm". */
const isPlain = (parsed: ParsedFootprint) => parsed.variant === undefined && Object.keys(parsed.params).length === 0

/** Tried in order; the first family that accepts the string makes the footprint. */
const FAMILIES: readonly Family[] = [
  (parsed) => (parsed.kind === "" && isPlain(parsed) ? chipFootprint(parsed.code) : undefined),
  (parsed) => (parsed.kind === "sod" && isPlain(parsed) ? sodFootprint(parsed.code) : undefined),
  sotFootprint,
  dualFootprint,
  quadFootprint,
  pinRowFootprint,
]

/** Footprint strings in a project are few; the bound only guards against unbounded growth. */
const MAX_CACHED = 512
const cache = new Map<string, FootprintResult>()

/**
 * The footprint for a footprint string such as "0603", "sod123", "soic8", "qfn32_ep" or
 * "pinrow4_p2.54mm", or an error naming the string.
 * Results are cached by text and frozen. `readFile` reads project files for footprints that come
 * from a file; the generated families here do not need it.
 */
export function generateFootprint(text: string, readFile?: (path: string) => string | undefined): FootprintResult {
  const cached = cache.get(text)
  if (cached) return cached
  const result = deepFreeze(build(text))
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string)
  cache.set(text, result)
  return result
}

/** How many pads the footprint has, or undefined when copperflow cannot make it. */
export function padCount(text: string): number | undefined {
  const result = generateFootprint(text)
  return "error" in result ? undefined : result.pads.length
}

function build(text: string): FootprintResult {
  const parsed = parseFootprint(text)
  if (parsed) {
    for (const family of FAMILIES) {
      const footprint = family(parsed)
      if (footprint) return footprint
    }
  }
  return { error: `copperflow cannot make footprint "${text}" yet` }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
