// What choosing a package does for whoever opened the Packages dialog. Kept apart from packages.ts, which carries the
// catalogue and the footprint generator, so the footprint manager and the inspector can use it without loading them.
// Pure.
import type { Edit } from "../../../src/core/types.js"
import { propEdit } from "../inspector-sections.js"

const USE_LABEL = "Use this footprint"

/**
 * Who opened the dialog: to look and copy, to fill a footprint manager row, to set the selected part's footprint, or
 * to fill the New part dialog's footprint field.
 */
export type PackagesPurpose = { kind: "look" } | { kind: "manager"; part: string } | { kind: "inspector"; part: string } | { kind: "newPart" }

/** The use button's label, or undefined when the dialog was opened only to look. */
export const buttonLabel = (purpose: PackagesPurpose): string | undefined => (purpose.kind === "look" ? undefined : USE_LABEL)

/** What Enter does: use the package when there is something to use it for, else copy its string. */
export const enterAction = (purpose: PackagesPurpose): "use" | "copy" => (purpose.kind === "look" ? "copy" : "use")

/** Whether the first row is selected unasked: only when looking; when choosing, nothing until the person picks. */
export const preselects = (purpose: PackagesPurpose): boolean => purpose.kind === "look"

/** What Enter does with the shown string: a string that cannot be made is never used, only copied when looking. */
export function enterOutcome(purpose: PackagesPurpose, valid: boolean): "use" | "copy" | "nothing" {
  if (enterAction(purpose) === "copy") return "copy"
  return valid ? "use" : "nothing"
}

/** The footprint manager's typed changes with one row's field set to the chosen string. */
export const managerChange = (changes: Readonly<Record<string, string>>, part: string, footprint: string): Record<string, string> => ({ ...changes, [part]: footprint })

/** The edit the inspector makes when the chosen string is typed into the part's footprint field. */
export const inspectorEdit = (part: string, footprint: string): { edits: Edit[]; summary: string } => propEdit(part, "footprint", footprint)
