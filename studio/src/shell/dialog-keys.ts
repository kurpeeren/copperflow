// The keys of an open dialog (Help → Keys, Help → About): Esc closes it, Tab and Shift+Tab go round its controls
// without leaving it, and every other key stays in the dialog (the key gate keeps it from the canvas behind).

export type DialogKey = "close" | "trap" | "hold"

export function dialogKey(key: string): DialogKey {
  if (key === "Escape") return "close"
  return key === "Tab" ? "trap" : "hold"
}

/** The control Tab moves to among `count`, from `index` (-1 when the focus is on none of them); -1 when there are none. */
export function trapStep(index: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1
  if (index < 0 || index >= count) return backwards ? count - 1 : 0
  return (index + (backwards ? -1 : 1) + count) % count
}
