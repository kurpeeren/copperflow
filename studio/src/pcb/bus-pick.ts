// The small list of a bus's members the W tool opens where a wire meets a bus: what each key does to it, and where it
// opens. Pure;
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

/** The list's size in CSS pixels, as bus-members.css draws it: its width, each row, its frame, and the most it grows. */
export const LIST_WIDTH_PX = 100
const ROW_PX = 21
const FRAME_PX = 6
export const LIST_MAX_HEIGHT_PX = 220
/** Where the list opens, beside the point where the wire meets the bus. */
const OFFSET_PX = 12

/** How tall the list of `count` members is. */
export const listHeight = (count: number): number => Math.min(count * ROW_PX + FRAME_PX, LIST_MAX_HEIGHT_PX)

/** The list's top-left corner: beside the meeting point (screen pixels), moved back inside the canvas when it would spill out. */
export function listPlace(at: { x: number; y: number }, size: { width: number; height: number }, count: number): { left: number; top: number } {
  const left = Math.min(at.x + OFFSET_PX, size.width - LIST_WIDTH_PX)
  const top = Math.min(at.y + OFFSET_PX, size.height - listHeight(count))
  return { left: Math.max(left, 0), top: Math.max(top, 0) }
}
