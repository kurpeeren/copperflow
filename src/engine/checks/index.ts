import type { Circuit } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PcbLayout } from "../pcb.js"
import { netClasses } from "../rules/classes.js"
import { DEFAULT_CLASS } from "../rules/profiles.js"
import type { Rules } from "../rules/schema.js"
import type { SchematicLayout } from "../schematic.js"
import { padChecks } from "./drc-pads.js"
import { partChecks } from "./drc-parts.js"
import { electricalChecks } from "./erc.js"
import { violation, type Violation } from "./violation.js"

export type { Violation } from "./violation.js"

const severityRank = (v: Violation): number => (v.severity === "error" ? 0 : 1)

const byReportOrder = (a: Violation, b: Violation): number =>
  severityRank(a) - severityRank(b) || naturalCompare(a.code, b.code) || naturalCompare(a.id, b.id)

/** One warning for an id two checks both produced; that can only be a bug in the checks. */
const duplicateWarning = (id: string): Violation =>
  violation("unchecked", "warning", `Two checks reported the violation ${id}; only the first is kept. This is a bug in the checks.`, [id], "pcb")

/**
 * Sorts violations (errors first, then code, then id, naturally). Of several with one id the first
 * is kept, and each such id adds one `unchecked` warning. Builds a new list.
 */
export function mergeViolations(found: readonly Violation[]): Violation[] {
  const kept = new Map<string, Violation>()
  const duplicated = new Set<string>()
  for (const item of found) {
    if (kept.has(item.id)) duplicated.add(item.id)
    else kept.set(item.id, item)
  }
  const warnings = [...duplicated].map(duplicateWarning).filter((warning) => !kept.has(warning.id))
  return [...kept.values(), ...warnings].sort(byReportOrder)
}

const hasPosition = (part: PcbLayout["parts"][number]): boolean => Number.isFinite(part.x) && Number.isFinite(part.y)

/** A part without a position (auto-placed on a board of no size) has no copper to measure: one warning, and the placement checks leave it out. */
const unplaced = (part: PcbLayout["parts"][number]): Violation =>
  violation("unchecked", "warning", `${part.component} has no position on the board, so its placement is not checked`, [part.component], "pcb")

/** Every electrical and design-rule violation of one build, in report order. */
export function checkDesign(circuit: Circuit, schematic: SchematicLayout, layout: PcbLayout, rules: Rules): Violation[] {
  const byNet = netClasses(rules, circuit.nets).byNet
  const classOf = (net: string | undefined): string => (net === undefined ? DEFAULT_CLASS.name : (byNet.get(net) ?? DEFAULT_CLASS.name))
  const placed = { ...layout, parts: layout.parts.filter(hasPosition) }
  const skipped = layout.parts.filter((part) => !hasPosition(part)).map(unplaced)
  return mergeViolations([...electricalChecks(circuit, schematic, rules), ...padChecks(placed, rules, classOf), ...partChecks(placed, rules), ...skipped])
}
