const LENGTH = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(mm|in|mil)?$/i
const ANGLE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(deg)?$/i
const MM_PER_UNIT: Readonly<Record<string, number>> = { mm: 1, in: 25.4, mil: 0.0254 }

/** A length in millimetres from 2.54, "2.54", "2.54mm", "0.1in" or "100mil". */
export function parseLength(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value !== "string") return undefined
  const match = LENGTH.exec(value.trim())
  if (!match) return undefined
  const result = Number(match[1]) * (MM_PER_UNIT[(match[2] ?? "mm").toLowerCase()] ?? 1)
  return Number.isFinite(result) ? result : undefined
}

/** An angle in degrees within [0, 360) from 90, "90deg" or -90. */
export function parseAngle(value: unknown): number | undefined {
  let degrees: number
  if (typeof value === "number") degrees = value
  else if (typeof value === "string") {
    const match = ANGLE.exec(value.trim())
    if (!match) return undefined
    degrees = Number(match[1])
  } else return undefined
  return Number.isFinite(degrees) ? ((degrees % 360) + 360) % 360 : undefined
}
