// The small list of a bus's members the W tool opens where a wire meets a bus: what each key does to it. Pure;
// BusMemberList.tsx draws it and use-wire-tool.ts writes the wire to the member picked.

/** What a key does in the list: move the highlight, pick the highlighted member, or close the list. */
export type MemberKey = { index: number } | { pick: number } | { cancel: true }

/** The arrows move round the list (Home and End to its ends), Enter picks, Esc cancels; other keys do nothing. */
export function memberKey(index: number, count: number, key: string): MemberKey | undefined {
  switch (key) {
    case "ArrowDown":
      return { index: (index + 1) % count }
    case "ArrowUp":
      return { index: (index - 1 + count) % count }
    case "Home":
      return { index: 0 }
    case "End":
      return { index: count - 1 }
    case "Enter":
      return { pick: index }
    case "Escape":
      return { cancel: true }
    default:
      return undefined
  }
}
