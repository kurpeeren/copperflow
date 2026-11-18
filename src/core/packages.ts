// The catalogue of standard packages as text, for the command line and for agents: search and compact listing. Pure.
import { findPackages, PACKAGE_FORMS, PACKAGE_GROUPS, packageFacts, type PackageEntry } from "../engine/footprints/catalogue.js"
import { generateFootprint } from "../engine/footprints/index.js"
import { nearestFootprints } from "../engine/footprints/known.js"
import { padRoles } from "../engine/footprints/pad-roles.js"
import { padLines } from "./pad-lines.js"

export interface FormatOptions {
  /** Show each package's other strings after its name (useful when a search was made). */
  readonly also?: boolean
  /** Leave the less common sizes out, and end with a line saying how many were left out. */
  readonly hideExtras?: boolean
  /** End with the general forms of the families that take numbers. */
  readonly forms?: boolean
}

const HEADER = "Packages: string to type as the footprint, name, pads, courtyard mm, mount (smd or th)"
const FORMS_HEADING = "General forms (any size works; the above are examples):"
const GAP = "  "

const mountText = (mount: string) => (mount === "through-hole" ? "th" : "smd")

interface Cells {
  readonly footprint: string
  readonly name: string
  readonly rest: string
}

function cells(entry: PackageEntry, options: FormatOptions): Cells {
  const facts = packageFacts(entry)
  const also = options.also && entry.also !== undefined ? ` (also ${entry.also.join(", ")})` : ""
  return { footprint: entry.footprint, name: `${entry.name}${also}`, rest: `${facts.pads}  ${facts.width}x${facts.height}  ${mountText(facts.mount)}` }
}

/** The lines of one group, columns aligned within the group. */
function groupLines(entries: readonly PackageEntry[], options: FormatOptions): string[] {
  const all = entries.map((entry) => cells(entry, options))
  const footprintWidth = Math.max(...all.map((cell) => cell.footprint.length))
  const nameWidth = Math.max(...all.map((cell) => cell.name.length))
  return all.map((cell) => `  ${cell.footprint.padEnd(footprintWidth)}${GAP}${cell.name.padEnd(nameWidth)}${GAP}${cell.rest}`)
}

function formLines(): string[] {
  const width = Math.max(...PACKAGE_FORMS.map((one) => one.form.length))
  return [FORMS_HEADING, ...PACKAGE_FORMS.map((one) => `  ${one.form.padEnd(width)}${GAP}${one.says}`)]
}

/** The packages as text: a heading per group (in catalogue order) over one line per package. */
export function formatPackages(entries: readonly PackageEntry[], options: FormatOptions = {}): string {
  const shown = options.hideExtras ? entries.filter((entry) => entry.extra !== true) : entries
  const hidden = entries.length - shown.length
  const sections = PACKAGE_GROUPS.flatMap((group) => {
    const inGroup = shown.filter((entry) => entry.group === group)
    return inGroup.length === 0 ? [] : [[group, ...groupLines(inGroup, options)].join("\n")]
  })
  const more = hidden > 0 ? [`${hidden} more sizes are left out here; a search lists them (packages dip, packages qfn).`] : []
  return [HEADER, ...sections, ...(options.forms ? [formLines().join("\n")] : []), ...more].join("\n")
}

/** The line for a search that found nothing, with the nearest valid strings when the first word looks like one. */
export function noPackageText(words: readonly string[]): string {
  const nearest = words.length === 1 ? nearestFootprints(words[0] as string) : []
  const near = nearest.length > 0 ? ` Nearest strings: ${nearest.join(", ")}.` : ""
  return `No package matches "${words.join(" ")}".${near} Search with no words lists them all.`
}

/** A search that matches at most this many packages lists each one's pads. */
export const PADS_LISTED_UP_TO = 3

/** "dcjack pads: number, centre, size (mm), hole, role" and one line per pad. */
export function packagePadLines(entry: PackageEntry): string[] {
  const footprint = generateFootprint(entry.footprint)
  if ("error" in footprint) return []
  const roles = padRoles(entry)
  return [`${entry.footprint} pads: number, centre, size (mm), hole${roles ? ", role" : ""}`, ...padLines(footprint.pads, (number) => roles?.[number])]
}

/** The answer to a search: the whole catalogue for no words, the matching packages otherwise (with their pads when few), or the no-match line. */
export function packagesText(words: readonly string[]): { text: string; found: boolean } {
  const entries = findPackages(words)
  if (entries.length === 0) return { text: noPackageText(words), found: false }
  const whole = words.length === 0
  const list = formatPackages(entries, { also: !whole, forms: whole, hideExtras: whole })
  const pads = !whole && entries.length <= PADS_LISTED_UP_TO ? entries.flatMap(packagePadLines) : []
  return { text: [list, ...pads].join("\n"), found: true }
}
