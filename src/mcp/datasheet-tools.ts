// set_part_fields { datasheet }: the datasheet a part's pins came from.
import { attachDatasheet, formatAttach } from "../library/attach-datasheet.js"

export async function attachDatasheetTool(root: string, input: { part: string; url: string; title?: string | undefined; pages?: string | undefined }): Promise<string> {
  const { title, pages, ...rest } = input
  return formatAttach(await attachDatasheet(root, { ...rest, ...(title ? { title } : {}), ...(pages ? { pages } : {}) }, new Date().toISOString()))
}
