// The Verify screen's items: the "- [ ]" lines of verification.md, the pin items shown as the rows of the pin table and
// every other item listed apart. Ticks made before the part changed count as open. Pure.
import { checklistItems, ticksCurrent, type ChecklistItem } from "../../../src/core/checklist-text.js"
import type { Footprint } from "../../../src/engine/footprints/types.js"
import { byNumber } from "./verify-figures.js"

export interface PinRow {
  number: string
  name: string
  /** The pin type in words: "power in". */
  type: string
  /** "Power" or "Ground" for those rows, so they read apart without colour; else "". */
  kind: "Power" | "Ground" | ""
  /** How many pads of the footprint carry this number (a connector's shell can have several). */
  pads: number
  /** The pin's item in verification.md, when the file has one. */
  item?: ChecklistItem
}

export interface ScreenItems {
  pins: PinRow[]
  others: ChecklistItem[]
  total: number
  open: number
  /** Some items were ticked for content the part no longer has: they show as open. */
  stale: boolean
}

const PIN_ITEM = /^Pin (\S+) is /

export function screenItems(checklist: string, hash: string, pins: Readonly<Record<string, { name: string; type: string }>>, footprint: Footprint | undefined): ScreenItems {
  const current = ticksCurrent(checklist, hash)
  const read = checklistItems(checklist)
  const items = read.map((item) => (current ? item : { ...item, ticked: false }))
  const byPin = new Map<string, ChecklistItem>()
  for (const item of items) {
    const number = PIN_ITEM.exec(item.text)?.[1]
    if (number !== undefined && pins[number] !== undefined && !byPin.has(number)) byPin.set(number, item)
  }
  const rows = Object.entries(pins)
    .sort(([a], [b]) => byNumber(a, b))
    .map(([number, pin]): PinRow => {
      const item = byPin.get(number)
      return { number, name: pin.name, type: pin.type.replace("_", " "), kind: kindOf(pin.type), pads: footprint?.pads.filter((pad) => pad.number === number).length ?? 0, ...(item ? { item } : {}) }
    })
  const shownInRows = new Set(byPin.values())
  return {
    pins: rows,
    others: items.filter((item) => !shownInRows.has(item)),
    total: items.length,
    open: items.filter((item) => !item.ticked).length,
    stale: !current && read.some((item) => item.ticked),
  }
}

function kindOf(type: string): PinRow["kind"] {
  if (type === "power_in" || type === "power_out") return "Power"
  return type === "ground" ? "Ground" : ""
}

export interface MarkForm {
  by: string
  against: string
  confirm: string
}

/** Mark verified: every item ticked, a name and what it was checked against, the id typed back, no placeholder. */
export function canMark(id: string, items: ScreenItems, form: MarkForm, placeholder: boolean): boolean {
  return !placeholder && items.open === 0 && form.by.trim() !== "" && form.against.trim() !== "" && form.confirm.trim() === id
}

/** What Mark verified still needs, in one short line ("Still missing: 3 items open; your name; type the id."), or "". */
export function markMissing(id: string, items: ScreenItems, form: MarkForm, placeholder: boolean): string {
  const missing = [
    ...(placeholder ? ["a real footprint (this one is a placeholder)"] : []),
    ...(items.open > 0 ? [`${items.open} item${items.open === 1 ? "" : "s"} open`] : []),
    ...(form.by.trim() === "" ? ["your name"] : []),
    ...(form.against.trim() === "" ? ["what it was checked against"] : []),
    ...(form.confirm.trim() !== id ? ["type the id"] : []),
  ]
  return missing.length === 0 ? "" : `Still missing: ${missing.join("; ")}.`
}

/** The pin items, for "Tick all pins": only those not ticked yet. */
export function openPinItems(items: ScreenItems): string[] {
  return items.pins.flatMap((row) => (row.item && !row.item.ticked ? [row.item.text] : []))
}
