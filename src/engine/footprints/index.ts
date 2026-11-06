import { chipFootprint } from "./chip.js"
import { dualFootprint } from "./dual.js"
import { footprintFromFile } from "./file.js"
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

/** The only files a footprint is read from: the footprint.yaml inside a library part's folder. */
const FILE_PATH = /^parts\/[A-Za-z0-9._-]+\/footprint\.yaml$/

/** Footprint strings never contain "/"; anything that does names a file. */
const isFilePath = (text: string) => text.includes("/")

/**
 * The footprint for a footprint string such as "0603", "sod123", "soic8", "qfn32_ep" or
 * "pinrow4_p2.54mm", or an error naming the string.
 * Results for strings are cached by text and frozen. A string that is a path
 * ("parts/<id>/footprint.yaml") is read through `readFile` every time, because the file can change
 * while the text of the path does not.
 */
export function generateFootprint(text: string, readFile?: (path: string) => string | undefined): FootprintResult {
  if (isFilePath(text)) return deepFreeze(fromFile(text, readFile))
  const cached = cache.get(text)
  if (cached) return cached
  const result = deepFreeze(build(text))
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string)
  cache.set(text, result)
  return result
}

function fromFile(path: string, readFile: ((path: string) => string | undefined) | undefined): FootprintResult {
  if (!FILE_PATH.test(path) || path.split("/").some((part) => part.includes(".."))) {
    return { error: `"${path}" is not a footprint file: only parts/<id>/footprint.yaml can be read` }
  }
  if (!readFile) return { error: `"${path}" is a footprint file and needs a way to read files` }
  const source = readFile(path)
  return source === undefined ? { error: `${path}: footprint file not found` } : footprintFromFile(path, source)
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
