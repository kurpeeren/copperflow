/** One drawing call with the paint state that was current when it was made. */
export interface DrawCall {
  name: string
  args: unknown[]
  strokeStyle: unknown
  fillStyle: unknown
  globalAlpha: number
  lineWidth: number
  /** The font when the call was made, so a test can read the size a text was written at. */
  font: string
}

/** Width per character of the fake font, in font sizes. */
export const FAKE_CHAR_WIDTH = 0.6

/** The fake measure: each character is FAKE_CHAR_WIDTH of the font's px size (10 px when no size is set). */
export function fakeTextWidth(text: string, font: string): number {
  const px = Number(/([\d.]+)px/.exec(font)?.[1] ?? 10)
  return text.length * px * FAKE_CHAR_WIDTH
}

/** The px size of a font string, such as 7 for "600 7px Segoe UI". */
export const fontPx = (font: string): number => Number(/([\d.]+)px/.exec(font)?.[1] ?? NaN)

/** A 2D context that records what was drawn. `calls` holds the call names; `records` holds the details. */
export function recorder() {
  const calls: string[] = []
  const records: DrawCall[] = []
  const state = { fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "", textBaseline: "", globalAlpha: 1, lineCap: "", lineJoin: "" }
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key as keyof typeof target]
      return (...args: unknown[]) => {
        calls.push(String(key))
        records.push({ name: String(key), args, strokeStyle: target.strokeStyle, fillStyle: target.fillStyle, globalAlpha: target.globalAlpha, lineWidth: target.lineWidth, font: target.font })
        if (key === "measureText") return { width: fakeTextWidth(String(args[0]), target.font) }
        return undefined
      }
    },
    set(target, key, value) {
      ;(target as Record<string, unknown>)[key as string] = value
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, records }
}
