// The keys of every tab list in the chrome (document tabs, the side strips, the Project Design sub-tabs and the
// bottom strip): the arrow keys step to the next or previous tab and wrap at the ends, Home and End jump to them.

const BACK = new Set(["ArrowLeft", "ArrowUp"])
const FORWARD = new Set(["ArrowRight", "ArrowDown"])

/** The tab a key moves to from `current`, or null for a key that is not a tab-list key (or an empty list). */
export function tabAfterKey<T>(ids: readonly T[], current: T, key: string): T | null {
  if (ids.length === 0) return null
  if (key === "Home") return ids[0] ?? null
  if (key === "End") return ids[ids.length - 1] ?? null
  const step = BACK.has(key) ? -1 : FORWARD.has(key) ? 1 : 0
  if (step === 0) return null
  const index = Math.max(0, ids.indexOf(current))
  return ids[(index + step + ids.length) % ids.length] ?? null
}
