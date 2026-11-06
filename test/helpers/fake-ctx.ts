/** One drawing call with the paint state that was current when it was made. */
export interface DrawCall {
  name: string
  args: unknown[]
  strokeStyle: unknown
  fillStyle: unknown
  globalAlpha: number
}

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
        records.push({ name: String(key), args, strokeStyle: target.strokeStyle, fillStyle: target.fillStyle, globalAlpha: target.globalAlpha })
        if (key === "measureText") return { width: 10 }
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
