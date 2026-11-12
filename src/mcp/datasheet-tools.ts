// attach_datasheet, and the hosted rule that a chip's pins come from a datasheet.
import { z } from "zod"
import { attachDatasheet, formatAttach } from "../library/attach-datasheet.js"
import { parsePinTable } from "../library/pin-table.js"

export const attachDatasheetInput = {
  part: z.string().describe("Library part id"),
  url: z.string().max(2000).describe("The datasheet's http(s) link; it is recorded, never fetched"),
  title: z.string().max(200).optional().describe("The datasheet's name and revision"),
  pages: z.string().max(100).optional().describe('The pages the pin table is on, e.g. "3-4"'),
}

export const ATTACH_DATASHEET_DESCRIPTION =
  "Record the datasheet a part's pins came from: its link, title and pages go into part.yaml and verification.md, so the human checks the pins against that page. The link is not fetched. Read the datasheet with your own client."

/** The phrase a description carries when a chip's pins honestly do not come from a datasheet. */
export const NOT_FROM_DATASHEET = "Pins NOT from a datasheet"
const MAX_PINS_WITHOUT_DATASHEET = 3

export async function attachDatasheetTool(root: string, input: { part: string; url: string; title?: string | undefined; pages?: string | undefined }): Promise<string> {
  const { title, pages, ...rest } = input
  return formatAttach(await attachDatasheet(root, { ...rest, ...(title ? { title } : {}), ...(pages ? { pages } : {}) }, new Date().toISOString()))
}

function pinCount(pins: unknown): number {
  if (typeof pins === "string") return parsePinTable(pins).pins.length
  return typeof pins === "object" && pins !== null ? Object.keys(pins).length : 0
}

/**
 * Hosted only: a part with more than three pins needs a datasheet link, since pin tables written from memory are wrong;
 * a description that says "Pins NOT from a datasheet" lets it through, so the human sees that in the part.
 */
export function checkDatasheetRule(input: { pins: unknown; datasheet?: { url?: string | undefined } | undefined; description?: string | undefined }): void {
  if (pinCount(input.pins) <= MAX_PINS_WITHOUT_DATASHEET) return
  if (input.datasheet?.url) return
  if (input.description?.includes(NOT_FROM_DATASHEET)) return
  throw new Error(
    `A part with more than ${MAX_PINS_WITHOUT_DATASHEET} pins needs datasheet { url } of the datasheet you read the pins from (pin tables from memory are wrong). Read the datasheet, pass its link, then call attach_datasheet with the pages. If there is truly none, write "${NOT_FROM_DATASHEET}" in the description.`,
  )
}
