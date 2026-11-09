import { diagnostic } from "./diagnostics.js"
import type { Diagnostic, Point, SourceRef } from "./model.js"
import type { Props } from "./read-props.js"

/** Turns a prop's value into what the drawing needs, or undefined when it cannot. */
export type Parse<T> = (value: unknown) => T | undefined

export const finite: Parse<number> = (value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

export const nonEmpty: Parse<string> = (value) => (typeof value === "string" && value !== "" ? value : undefined)

/** Two or more points, each with a numeric x and y. */
export const pointList: Parse<Point[]> = (value) => {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const points = value.map((item) => {
    const x = finite((item as { x?: unknown } | null)?.x)
    const y = finite((item as { y?: unknown } | null)?.y)
    return x === undefined || y === undefined ? undefined : { x, y }
  })
  return points.every((point): point is Point => point !== undefined) ? points : undefined
}

export type NumberRule = "any" | "positive" | "not-negative"

const NUMBERS: Readonly<Record<NumberRule, { test: (n: number) => boolean; expected: string }>> = {
  any: { test: () => true, expected: "a number" },
  positive: { test: (n) => n > 0, expected: "a number greater than 0" },
  "not-negative": { test: (n) => n >= 0, expected: "a number of 0 or more" },
}

const numberParse = (rule: NumberRule): Parse<number> => (value) => {
  const n = finite(value)
  return n !== undefined && NUMBERS[rule].test(n) ? n : undefined
}

/** "one of solid, dashed or dotted" */
export const oneOf = (options: readonly string[]): string => `one of ${options.slice(0, -1).join(", ")} or ${options[options.length - 1] ?? ""}`

const LEFT_OUT = "the drawing is left out"

/**
 * Reads one drawing's props. A value that is there but unusable, or missing where the drawing needs one,
 * is a bad-value warning and leaves the drawing out (`usable` turns false); every call still returns a
 * placeholder, so a shape can be put together before that is checked. A prop no call read is an
 * unknown-prop warning and does not stop the drawing.
 */
export class DrawingReader {
  readonly diagnostics: Diagnostic[] = []
  private readonly read = new Set<string>()
  private failed = false

  constructor(
    private readonly props: Props,
    private readonly owner: string,
    private readonly source: SourceRef,
  ) {}

  get usable(): boolean {
    return !this.failed
  }

  private warn(code: string, message: string, key: string): void {
    this.diagnostics.push(diagnostic(code, "warning", message, [`${this.owner}.${key}`], this.source))
  }

  private take(key: string): unknown {
    this.read.add(key)
    return this.props[key]
  }

  private refuse<T>(key: string, message: string, placeholder: T): T {
    this.failed = true
    this.warn("bad-value", `${message}; ${LEFT_OUT}`, key)
    return placeholder
  }

  /** A prop the drawing cannot do without. */
  required<T>(key: string, parse: Parse<T>, expected: string, placeholder: T): T {
    const value = this.take(key)
    if (value === undefined) return this.refuse(key, `${this.owner} needs ${key}`, placeholder)
    return parse(value) ?? this.refuse(key, `${this.owner}: ${key} must be ${expected}`, placeholder)
  }

  /** A prop with a default, which `fallback` is. */
  optional<T>(key: string, parse: Parse<T>, expected: string, fallback: T): T {
    const value = this.take(key)
    if (value === undefined) return fallback
    return parse(value) ?? this.refuse(key, `${this.owner}: ${key} must be ${expected}`, fallback)
  }

  /** A number in sheet units (or degrees) the drawing needs. */
  need(key: string, rule: NumberRule = "any"): number {
    return this.required(key, numberParse(rule), NUMBERS[rule].expected, 0)
  }

  number(key: string, fallback: number, rule: NumberRule = "any"): number {
    return this.optional(key, numberParse(rule), NUMBERS[rule].expected, fallback)
  }

  choice<T extends string>(key: string, options: readonly T[], fallback: T): T {
    const known: Parse<T> = (value) => options.find((option) => option === value)
    return this.optional(key, known, oneOf(options), fallback)
  }

  /** Reports every prop that no call read. */
  reportUnread(tag: string): void {
    for (const key of Object.keys(this.props)) {
      if (!this.read.has(key)) this.warn("unknown-prop", `${this.owner}: <${tag}> has no prop ${key}`, key)
    }
  }
}
