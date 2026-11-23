// The Verify screen's datasheet: the link at the first page named in datasheet_pages, and what "Checked against"
// starts from. The Studio never fetches the link; the browser opens it in a new tab. Pure.

export interface DatasheetRecord {
  url?: string
  file?: string
  title?: string
}

/** The first page named in datasheet_pages: "3-4" is 3, "1 (18-lead SOIC pinout), 4 (Table 1-1)" is 1. */
export function firstPage(pages: string | undefined): number | undefined {
  const match = /^\s*(\d+)/.exec(pages ?? "")
  const page = match ? Number(match[1]) : undefined
  return page !== undefined && page > 0 ? page : undefined
}

/** Whether the link names a PDF file, so a viewer can open it at a page. */
function isPdf(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf")
  } catch {
    return false
  }
}

/** The link to open: at the first page when it is a PDF and a page is known, else as it is. */
export function datasheetLink(url: string, pages: string | undefined): string {
  const page = firstPage(pages)
  if (page === undefined || !isPdf(url)) return url
  return `${url.replace(/#.*$/, "")}#page=${page}`
}

/** A frame's address for a local PDF, at the first page named. */
export function framedAt(address: string, pages: string | undefined): string {
  const page = firstPage(pages)
  return page === undefined ? address : `${address}#page=${page}`
}

/** What "Checked against" starts from: the datasheet's title (or its link) and the pages. */
export function checkedAgainst(datasheet: DatasheetRecord | undefined, pages: string | undefined): string {
  const name = datasheet?.title ?? datasheet?.url ?? datasheet?.file ?? ""
  if (name === "") return ""
  return pages === undefined ? name : `${name}, page(s) ${pages}`
}

/** What the screen says when the part records no datasheet. */
export const NO_DATASHEET = 'This part records no datasheet. Ask the agent to attach it (set_part_fields { datasheet }), or add it to part.yaml: datasheet: { url: "https://…", title: "…" } and datasheet_pages: "3-4".'
