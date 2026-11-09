import type { DrawingInfo } from "./types.js"

/** How many characters two texts share at the start and, after those, at the end. */
function commonEnds(a: string, b: string): { prefix: number; suffix: number } {
  const most = Math.min(a.length, b.length)
  let prefix = 0
  while (prefix < most && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (suffix < most - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++
  return { prefix, suffix }
}

/**
 * Tells whether a drawing in `source` and the drawing with its id in `next` are the same element: the same
 * text, and, where either lies in text the change left alone, at the place that text moved to. So an unnamed
 * twin written the same way cannot take a locked drawing's id unnoticed.
 */
export function drawingKeeper(source: string, next: string): (drawing: DrawingInfo, now: DrawingInfo) => boolean {
  let ends: { prefix: number; suffix: number } | undefined
  const shift = next.length - source.length
  return (drawing, now) => {
    if (next.slice(now.start, now.end) !== source.slice(drawing.start, drawing.end)) return false
    ends ??= commonEnds(source, next)
    const { prefix, suffix } = ends
    /** Where an element left alone by the change sits in the other text; undefined when the change touched it. */
    const moved = (start: number, end: number, length: number, by: number) =>
      end <= prefix ? start : start >= length - suffix ? start + by : undefined
    const forward = moved(drawing.start, drawing.end, source.length, shift)
    const back = moved(now.start, now.end, next.length, -shift)
    return (forward === undefined || forward === now.start) && (back === undefined || back === drawing.start)
  }
}
