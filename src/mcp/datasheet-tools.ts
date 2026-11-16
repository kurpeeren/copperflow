// attach_datasheet.
import { z } from "zod"
import { attachDatasheet, formatAttach } from "../library/attach-datasheet.js"

export const attachDatasheetInput = {
  part: z.string().describe("Library part id"),
  url: z.string().max(2000).describe("The datasheet's http(s) link; it is recorded, never fetched"),
  title: z.string().max(200).optional().describe("The datasheet's name and revision"),
  pages: z.string().max(100).optional().describe('The pages the pin table is on, e.g. "3-4"'),
}

export const ATTACH_DATASHEET_DESCRIPTION =
  "Record the datasheet a part's pins came from: its link, title and pages go into part.yaml and verification.md, so the human checks the pins against that page. The link is not fetched. Read the datasheet with your own client."

export async function attachDatasheetTool(root: string, input: { part: string; url: string; title?: string | undefined; pages?: string | undefined }): Promise<string> {
  const { title, pages, ...rest } = input
  return formatAttach(await attachDatasheet(root, { ...rest, ...(title ? { title } : {}), ...(pages ? { pages } : {}) }, new Date().toISOString()))
}
