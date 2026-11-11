// Design → Annotate designators, as plain data: every part named as a designator (letters then a number, R7) is
// numbered again by where its symbol sits, as EasyEDA annotates by default: page by page, then top to bottom, then left
// to right, from 1 within each letter prefix. Locked parts and parts the file cannot rename keep their names, and their
// numbers are skipped. The result is one renameParts edit, so one history entry. Pure.
import type { Edit } from "../../../src/core/types.js"

const DESIGNATOR = /^([A-Za-z_]+)(\d+)$/

export interface AnnotatePart {
  name: string
  /** Whether the file may give it a new name: a literal name, not locked. */
  renamable: boolean
  /** Where its symbol sits; a part without one is numbered after those with one. */
  at?: { page: number; x: number; y: number }
}

export type AnnotateResult = { edit: Extract<Edit, { kind: "renameParts" }>; summary: string } | { message: string }

/** Top to bottom (the sheet's y is up), then left to right, page by page; unplaced parts last, by name. */
function byPosition(a: AnnotatePart, b: AnnotatePart): number {
  if (!a.at || !b.at) return a.at ? -1 : b.at ? 1 : a.name.localeCompare(b.name)
  return a.at.page - b.at.page || b.at.y - a.at.y || a.at.x - b.at.x || a.name.localeCompare(b.name)
}

/** The new names of one prefix's parts: the free numbers from 1, in sheet order. */
function numberPrefix(prefix: string, parts: readonly AnnotatePart[]): { from: string; to: string }[] {
  const kept = new Set(parts.filter((part) => !part.renamable).map((part) => Number(DESIGNATOR.exec(part.name)?.[2])))
  let next = 1
  return [...parts]
    .filter((part) => part.renamable)
    .sort(byPosition)
    .map((part) => {
      while (kept.has(next)) next++
      return { from: part.name, to: `${prefix}${next++}` }
    })
}

export function annotatePlan(parts: readonly AnnotatePart[]): AnnotateResult {
  const groups = new Map<string, AnnotatePart[]>()
  for (const part of parts) {
    const prefix = DESIGNATOR.exec(part.name)?.[1]
    if (prefix !== undefined) groups.set(prefix, [...(groups.get(prefix) ?? []), part])
  }
  const mapping = [...groups].flatMap(([prefix, list]) => numberPrefix(prefix, list)).filter((change) => change.from !== change.to)
  if (mapping.length === 0) return { message: "Every designator is already numbered in order." }
  const shown = mapping.slice(0, 4).map((change) => `${change.from} → ${change.to}`).join(", ")
  return { edit: { kind: "renameParts", mapping }, summary: `annotate designators: ${shown}${mapping.length > 4 ? ` and ${mapping.length - 4} more` : ""}` }
}
