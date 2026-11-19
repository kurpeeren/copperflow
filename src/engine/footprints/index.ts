import { arrayFootprint } from "./array.js"
import { axialFootprint } from "./axial.js"
import { bgaFootprint } from "./bga.js"
import { chipFootprint } from "./chip.js"
import { crystalFootprint } from "./crystal.js"
import { dcJackFootprint } from "./dcjack.js"
import { dfnFootprint } from "./dfn.js"
import { dipFootprint } from "./dip.js"
import { dpakFootprint } from "./dpak.js"
import { dualExposedFootprint, dualFootprint } from "./dual.js"
import { footprintFromFile } from "./file.js"
import { inductorFootprint } from "./inductor.js"
import { unknownFootprint } from "./known.js"
import { ledSmdFootprint } from "./ledsmd.js"
import { ledThroughHoleFootprint } from "./ledth.js"
import { melfFootprint } from "./melf.js"
import { isSimple, parseFootprint, type ParsedFootprint } from "./parse.js"
import { moldedFootprint } from "./molded.js"
import { pinRowFootprint } from "./pinrow.js"
import { plccFootprint } from "./plcc.js"
import { quadFootprint } from "./quad.js"
import { radialFootprint } from "./radial.js"
import { trimmerFootprint } from "./trimmer.js"
import { wirepadFootprint } from "./wirepad.js"
import { resonatorFootprint } from "./resonator.js"
import { screwFootprint } from "./screw.js"
import { smallSotFootprint } from "./smallsot.js"
import { smdCanFootprint } from "./smdcan.js"
import { smdipFootprint } from "./smdip.js"
import { socketFootprint } from "./socket.js"
import { sodFamily } from "./sod.js"
import { sotFootprint } from "./sot.js"
import { tactFootprint } from "./tact.js"
import { powerSotFootprint } from "./sotpower.js"
import { tantalumFootprint } from "./tantalum.js"
import { to220Footprint } from "./to220.js"
import { to92Footprint } from "./to92.js"
import { to92InlineFootprint } from "./to92inline.js"
import { toPowerFootprint } from "./topower.js"
import { usbFootprint } from "./usb.js"
import { xtalFootprint } from "./xtal.js"
import { isRefusal, type Footprint, type Refusal } from "./types.js"

export type FootprintResult = Footprint | { error: string }

/**
 * A footprint family: makes a footprint from a parsed string, declines with undefined when the string is not its,
 * or refuses with a reason when the string is its kind but cannot be made.
 */
type Family = (parsed: ParsedFootprint) => Footprint | Refusal | undefined

/** No variant and no parameters: "0603", not "0603_5" or "0603_p0.5mm". */
const isPlain = (parsed: ParsedFootprint) =>
  isSimple(parsed) && parsed.variant === undefined && Object.keys(parsed.params).length === 0

/** Tried in order; the first family that accepts the string makes the footprint. */
const FAMILIES: readonly Family[] = [
  (parsed) => (parsed.kind === "" && isPlain(parsed) ? chipFootprint(parsed.code) : undefined),
  sodFamily,
  melfFootprint,
  sotFootprint,
  smallSotFootprint,
  powerSotFootprint,
  dpakFootprint,
  moldedFootprint,
  axialFootprint,
  tantalumFootprint,
  arrayFootprint,
  dualFootprint,
  dualExposedFootprint,
  smdipFootprint,
  plccFootprint,
  quadFootprint,
  dfnFootprint,
  bgaFootprint,
  pinRowFootprint,
  socketFootprint,
  screwFootprint,
  dipFootprint,
  to220Footprint,
  toPowerFootprint,
  to92Footprint,
  to92InlineFootprint,
  crystalFootprint,
  xtalFootprint,
  radialFootprint,
  trimmerFootprint,
  wirepadFootprint,
  smdCanFootprint,
  ledThroughHoleFootprint,
  ledSmdFootprint,
  resonatorFootprint,
  usbFootprint,
  dcJackFootprint,
  tactFootprint,
  inductorFootprint,
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

/**
 * How many pins the footprint has pads for (its distinct pad numbers: a SOT-89's tab is a second pad 2, so it counts
 * 3), or undefined when copperflow cannot make it.
 */
export function padCount(text: string): number | undefined {
  const result = generateFootprint(text)
  return "error" in result ? undefined : new Set(result.pads.map((pad) => pad.number)).size
}

function build(text: string): FootprintResult {
  const parsed = parseFootprint(text)
  if (parsed) {
    for (const family of FAMILIES) {
      const footprint = family(parsed)
      if (isRefusal(footprint)) return { error: `copperflow cannot make footprint "${text}": ${footprint.refused}` }
      if (footprint) return footprint
    }
  }
  return { error: unknownFootprint(text) }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
