import { parseLength } from "../units.js"

/**
 * A footprint string split into parts: "soic8_w5.3mm_p1.27mm" is kind "soic", code "8" and
 * parameters w = 5.3, p = 1.27. Each family decides what its code means (a pin count for "soic8",
 * a package variant for "sod123", an EIA size for "0603").
 */
export interface ParsedFootprint {
  /** Letters before the code, "" for bare codes such as "0603". */
  kind: string
  /** Digits after the kind, "" when there are none. */
  code: string
  /** `_w5.3mm` gives w = 5.3 (mm, via parseLength); a bare `_male` gives male = true. */
  params: Readonly<Record<string, number | true>>
}

const HEAD = /^([a-z]*)(\d*)$/
const PARAM = /^([a-z]+)(.*)$/

/** Splits a footprint string, case-insensitively. Undefined when it does not have this shape. */
export function parseFootprint(text: string): ParsedFootprint | undefined {
  const [head = "", ...segments] = text.trim().toLowerCase().split("_")
  const match = HEAD.exec(head)
  if (!match || head === "") return undefined
  const params = parseParams(segments)
  if (!params) return undefined
  return { kind: match[1] ?? "", code: match[2] ?? "", params }
}

function parseParams(segments: readonly string[]): Record<string, number | true> | undefined {
  const params: Record<string, number | true> = {}
  for (const segment of segments) {
    const match = PARAM.exec(segment)
    if (!match) return undefined
    const key = match[1] ?? ""
    const value = match[2] ?? ""
    if (Object.hasOwn(params, key)) return undefined
    const parsed = value === "" ? true : parseLength(value)
    if (parsed === undefined) return undefined
    params[key] = parsed
  }
  return params
}
