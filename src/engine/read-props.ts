import { diagnostic } from "./diagnostics.js"
import type { Diagnostic, Point, SourceRef } from "./model.js"
import { parseAngle, parseLength } from "./units.js"

export type Props = Readonly<Record<string, unknown>>

/** Reads typed props and reports the ones that are present but unusable as `bad-value` warnings. */
export class PropReader {
  readonly diagnostics: Diagnostic[] = []

  constructor(
    private readonly props: Props,
    private readonly owner: string,
    private readonly source: SourceRef,
  ) {}

  private bad(key: string, expected: string): undefined {
    const message = `${this.owner}: ${key} must be ${expected}`
    this.diagnostics.push(diagnostic("bad-value", "warning", message, [`${this.owner}.${key}`], this.source))
    return undefined
  }

  private has(key: string): boolean {
    return this.props[key] !== undefined
  }

  length(key: string): number | undefined {
    if (!this.has(key)) return undefined
    return parseLength(this.props[key]) ?? this.bad(key, 'a length such as 2.54, "2.54mm" or "100mil"')
  }

  angle(key: string): number | undefined {
    if (!this.has(key)) return undefined
    return parseAngle(this.props[key]) ?? this.bad(key, 'an angle such as 90 or "90deg"')
  }

  /** A point written as `{{ x: 1, y: -0.5 }}`: two finite numbers and nothing else. */
  point(key: string): Point | undefined {
    if (!this.has(key)) return undefined
    return pointOf(this.props[key]) ?? this.bad(key, "a point such as { x: 0.5, y: -0.2 }")
  }

  string(key: string): string | undefined {
    const value = this.props[key]
    return typeof value === "string" && value !== "" ? value : undefined
  }
}

/** The value as a point when it is an object of exactly two finite numbers, x and y. */
export function pointOf(value: unknown): Point | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const keys = Object.keys(value)
  const { x, y } = value as { x?: unknown; y?: unknown }
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
  return keys.length === 2 && finite(x) && finite(y) ? { x, y } : undefined
}

/** The value as plain JSON, or undefined when it has none (functions, symbols, cycles, class instances). */
export function toJson(value: unknown, path: readonly object[] = []): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value !== "object" || path.includes(value)) return undefined
  const next = [...path, value]
  if (Array.isArray(value)) return value.map((item) => toJson(item, next) ?? null)
  if (Object.prototype.toString.call(value) !== "[object Object]") return undefined
  const entries = Object.entries(value).flatMap(([key, item]) => {
    const json = toJson(item, next)
    return json === undefined ? [] : [[key, json] as const]
  })
  return Object.fromEntries(entries)
}

export function jsonProps(props: Props): Record<string, unknown> {
  return toJson(props) as Record<string, unknown>
}
