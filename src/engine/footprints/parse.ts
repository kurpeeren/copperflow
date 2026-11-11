import { parseLength } from "../units.js"

/** Two lengths written `<a>x<b>`, such as the body "5x5" or the grid "rows16x16". */
export type Pair = readonly [number, number]

/**
 * A footprint string split into parts: "soic8_w5.3mm_p1.27mm" is kind "soic", code "8" and
 * parameters w = 5.3, p = 1.27. Each family decides what its code means (a pin count for "soic8",
 * a package variant for "sod123", an EIA size for "0603", a diameter for "radial6.3x2.5").
 */
export interface ParsedFootprint {
  /** Letters before the code, "" for bare codes such as "0603". */
  kind: string
  /** The number after the kind, "" when there is none. */
  code: string
  /** A number after an "x" in the head: "pinrow2x5" has cross "5", "radial6.3x2.5" cross "2.5". */
  cross?: string
  /** Letters after the code: "hc49s" has suffix "s", "do214ac" suffix "ac". */
  suffix?: string
  /** A bare number right after the code: "sot23_5" has variant "5". Absent when there is none. */
  variant?: string
  /** A bare `_<a>x<b>` segment, such as the body of "qfn32_5x5_p0.5". */
  size?: Pair
  /** `_w5.3mm` gives w = 5.3 (mm, via parseLength); a bare `_male` gives male = true. */
  params: Readonly<Record<string, number | true>>
  /** `_rows16x16` gives rows = [16, 16]; `_ep1.6x2.4` gives ep = [1.6, 2.4]. */
  pairs?: Readonly<Record<string, Pair>>
}

const NUMBER = String.raw`\d+(?:\.\d+)?`
const HEAD = new RegExp(String.raw`^([a-z]*)(${NUMBER})?(?:x(${NUMBER}))?([a-z]*)$`)
const VARIANT = /^\d+$/
const PARAM = /^([a-z]+)(.*)$/
const PAIR = new RegExp(String.raw`^(${NUMBER})(?:mm)?x(${NUMBER})(?:mm)?$`)

/** Splits a footprint string, case-insensitively. Undefined when it does not have this shape. */
export function parseFootprint(text: string): ParsedFootprint | undefined {
  const [head = "", ...segments] = text.trim().toLowerCase().split("_")
  const match = HEAD.exec(head)
  if (!match || head === "") return undefined
  const [, kind = "", code = "", cross, suffix = ""] = match
  const variant = VARIANT.test(segments[0] ?? "") ? segments[0] : undefined
  const rest = variant === undefined ? segments : segments.slice(1)
  const sizes = rest.filter((segment) => PAIR.test(segment))
  if (sizes.length > 1) return undefined
  const fields = parseParams(rest.filter((segment) => !PAIR.test(segment)))
  if (!fields) return undefined
  const size = sizes[0] === undefined ? undefined : pair(sizes[0])
  return {
    kind,
    code,
    ...(cross === undefined ? {} : { cross }),
    ...(suffix === "" ? {} : { suffix }),
    ...(variant === undefined ? {} : { variant }),
    ...(size === undefined ? {} : { size }),
    params: fields.params,
    ...(Object.keys(fields.pairs).length === 0 ? {} : { pairs: fields.pairs }),
  }
}

/**
 * True when the string has none of the head extras (cross, suffix) nor a size or pair parameters:
 * the shape of every string before the generated packages ("soic8_p1.27mm", "sot23_5").
 */
export function isSimple(parsed: ParsedFootprint): boolean {
  return parsed.cross === undefined && parsed.suffix === undefined && parsed.size === undefined && parsed.pairs === undefined
}

function pair(text: string): Pair | undefined {
  const match = PAIR.exec(text)
  return match ? [Number(match[1]), Number(match[2])] : undefined
}

interface Fields {
  params: Record<string, number | true>
  pairs: Record<string, Pair>
}

function parseParams(segments: readonly string[]): Fields | undefined {
  const params: Record<string, number | true> = {}
  const pairs: Record<string, Pair> = {}
  for (const segment of segments) {
    const match = PARAM.exec(segment)
    if (!match) return undefined
    const key = match[1] ?? ""
    const value = match[2] ?? ""
    if (Object.hasOwn(params, key) || Object.hasOwn(pairs, key)) return undefined
    const both = pair(value)
    if (both) {
      pairs[key] = both
      continue
    }
    const parsed = value === "" ? true : parseLength(value)
    if (parsed === undefined) return undefined
    params[key] = parsed
  }
  return { params, pairs }
}
