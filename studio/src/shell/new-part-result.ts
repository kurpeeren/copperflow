// Library → New part…: what the dialog sends and what the server answers. Types and one function only, so the
// Studio's main bundle can name these without the footprint generator, which the dialog loads when it opens.
import type { PinRow } from "../../../src/library/pin-table.js"

/** What the dialog sends to POST /api/create-part. */
export interface CreatePartRequest {
  id: string
  title: string
  manufacturer?: string
  mpn?: string
  package: string | { file: "footprint.yaml" }
  pins: PinRow[]
  suppliers?: Record<string, string>
  datasheet?: { url: string }
  replace: boolean
}

/** The server's answer. */
export interface CreatePartResult {
  id: string
  title: string
  pins: number
  footprint: string
  files: string[]
  /** What the person still has to do; also in verification.md. */
  notes: string[]
  /** verification.md's path in the project, and its text. */
  verification: string
  checklist: string
}

/** What Library → New part… asks the server; `create` throws with the server's message. */
export interface NewPartPanel {
  create(request: CreatePartRequest): Promise<CreatePartResult>
}

/** The result's first line. */
export function createdSummary(result: CreatePartResult): string {
  return `Created ${result.id}: ${result.title}, ${result.pins} pin${result.pins === 1 ? "" : "s"}, footprint ${result.footprint}. Not verified: check it in ${result.verification}.`
}
