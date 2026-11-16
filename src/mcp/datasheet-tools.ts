// attach_datasheet.
import { z } from "zod"
import { attachDatasheet, formatAttach } from "../library/attach-datasheet.js"

export const attachDatasheetInput = {
  part: z.string().describe("Library part id"),
  url: z.string().max(2000).describe("http(s) link"),
  title: z.string().max(200).optional(),
  pages: z.string().max(100).optional().describe('Pin table pages, e.g. "3-4"'),
}

export const ATTACH_DATASHEET_DESCRIPTION =
  "Record the datasheet a part's pins came from (link, title, pages) in part.yaml and verification.md. The link is not fetched."

export async function attachDatasheetTool(root: string, input: { part: string; url: string; title?: string | undefined; pages?: string | undefined }): Promise<string> {
  const { title, pages, ...rest } = input
  return formatAttach(await attachDatasheet(root, { ...rest, ...(title ? { title } : {}), ...(pages ? { pages } : {}) }, new Date().toISOString()))
}
