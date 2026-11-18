// Tools → Packages…, as plain data: the standard packages found by a search and a group, the selection moved by the
// keys, the facts of the package shown (or the generator's reason when a typed string cannot be made), and what
// choosing one does for whoever opened the dialog. Pure.
import { findPackages, PACKAGE_FORMS, type PackageEntry, type PackageGroup } from "../../../src/engine/footprints/catalogue.js"
import { generateFootprint } from "../../../src/engine/footprints/index.js"
import type { Footprint } from "../../../src/engine/footprints/types.js"
import { partHeight } from "../../../src/engine/solid/heights.js"
export { buttonLabel, enterAction, enterOutcome, inspectorEdit, managerChange, preselects, type PackagesPurpose } from "./packages-choice.js"

export type GroupChoice = PackageGroup | "all"
export type Mount = "Surface-mount" | "Through-hole"

export interface PackageRow {
  footprint: string
  name: string
  group: PackageGroup
  pads: number
  /** The courtyard, "5.9 × 5.5 mm". */
  size: string
  mount: Mount
}

export interface PackageDetails {
  footprint: string
  pads: number
  size: string
  mount: Mount
  /** Above the board, in mm. */
  height: number
  /** Where the height comes from, in plain words. */
  heightNote: string
  /** Where the footprint's numbers come from. */
  origin: string
}

export const SHAPE_NOTE = "Shapes are simple generated shapes, not the makers' models."
const NOT_A_STRING = "is not a footprint string; this preview shows generated footprints only"
const EMPTY = "Type a footprint string such as soic8, 0603 or qfn32_5x5_p0.5."

const tenth = (value: number) => Math.round(value * 10) / 10

interface Measured {
  pads: number
  size: string
  mount: Mount
}

function measure(footprint: Footprint): Measured {
  const xs = footprint.courtyard.map((point) => point.x)
  const ys = footprint.courtyard.map((point) => point.y)
  const [width, height] = xs.length === 0 ? [0, 0] : [tenth(Math.max(...xs) - Math.min(...xs)), tenth(Math.max(...ys) - Math.min(...ys))]
  return {
    pads: new Set(footprint.pads.map((pad) => pad.number)).size,
    size: `${width} × ${height} mm`,
    mount: footprint.pads.some((pad) => pad.layers === "through") ? "Through-hole" : "Surface-mount",
  }
}

/** The footprint a typed string makes, or why it cannot be made, in the generator's own words. */
function made(text: string): Footprint | { error: string } {
  const name = text.trim()
  if (name === "") return { error: EMPTY }
  if (name.includes("/")) return { error: `"${name}" ${NOT_A_STRING}` }
  return generateFootprint(name)
}

// The catalogue does not change while the Studio runs: each package is measured once.
const measured = new Map<string, Measured>()
function measuredEntry(entry: PackageEntry): Measured {
  const known = measured.get(entry.footprint)
  if (known) return known
  const footprint = made(entry.footprint)
  const value: Measured = "error" in footprint ? { pads: 0, size: "", mount: "Surface-mount" } : measure(footprint)
  measured.set(entry.footprint, value)
  return value
}

/** The packages in which every word of the search is found, in the group chosen, in catalogue order. */
export function packageRows(query: string, group: GroupChoice): PackageRow[] {
  return findPackages(query.split(/\s+/))
    .filter((entry) => group === "all" || entry.group === group)
    .map((entry) => ({ footprint: entry.footprint, name: entry.name, group: entry.group, ...measuredEntry(entry) }))
}

/**
 * The selection after the rows change: kept while its row is shown, else the first row; or nothing when `preselect`
 * is off, so a package nobody chose is never the one used.
 */
export function keptSelection(rows: readonly PackageRow[], current: string | undefined, preselect = true): string | undefined {
  if (rows.some((row) => row.footprint === current)) return current
  return preselect ? rows[0]?.footprint : undefined
}

/** The string the dialog first shows: a catalogue package is selected, any other string typed. */
export function startOf(initial: string | undefined): { selected?: string; typed: string } {
  const text = initial?.trim() ?? ""
  if (text === "") return { typed: "" }
  return findPackages([]).some((entry) => entry.footprint === text) ? { selected: text, typed: "" } : { typed: text }
}

/** How many rows Page Up and Page Down move. */
const PAGE = 10
const STEPS: Readonly<Record<string, (index: number, last: number) => number>> = {
  ArrowDown: (index) => index + 1,
  ArrowUp: (index) => index - 1,
  PageDown: (index) => index + PAGE,
  PageUp: (index) => index - PAGE,
  Home: () => 0,
  End: (_, last) => last,
}

/** Keys a text field keeps for its caret even though the list knows them. */
const CARET_KEYS = new Set(["Home", "End"])

/** Whether a key moves the selection in the list; in a text field Home and End stay the caret's. */
export const movesSelection = (key: string, inTextField = false): boolean => key in STEPS && !(inTextField && CARET_KEYS.has(key))

/** The selection after a key: one row, a page, or to an end; from nothing, the first row. */
export function movedSelection(rows: readonly PackageRow[], current: string | undefined, key: string): string | undefined {
  const step = STEPS[key]
  if (rows.length === 0) return undefined
  const index = rows.findIndex((row) => row.footprint === current)
  if (index < 0 || !step) return rows[Math.max(index, 0)]?.footprint
  const last = rows.length - 1
  return rows[Math.max(0, Math.min(last, step(index, last)))]?.footprint
}

/** Where the height comes from, as partHeight says it. */
function heightNote(footprint: string): { height: number; note: string } {
  const height = partHeight({ footprint, props: {} })
  if (height.state === "read") return { height: height.height, note: `from ${height.source}` }
  if (height.state === "typical") return { height: height.height, note: "typical for the package, not read from a datasheet" }
  if (height.state === "given") return { height: height.height, note: "given by the part" }
  return { height: height.height, note: "assumed: the package's height is not known" }
}

/** What a footprint string makes: pads, courtyard, mount, height and origin; or why it cannot be made. */
export function packageDetails(text: string): PackageDetails | { error: string } {
  const footprint = made(text)
  if ("error" in footprint) return { error: footprint.error }
  const name = text.trim()
  const { height, note } = heightNote(name)
  return { footprint: name, ...measure(footprint), height, heightNote: note, origin: footprint.origin }
}

/** The families that take any size, one per line, for the typed string's hint. */
export const formsHint = (): string => PACKAGE_FORMS.map((form) => `${form.form}: ${form.says}`).join("\n")
