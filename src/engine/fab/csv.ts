// CSV fields for the fabrication and BOM files. Pure.

/** A field quoted when it holds a comma, a quote or a line end, quotes doubled. */
export function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** A cell for text people wrote: a leading = + - @ makes spreadsheets run the cell as a formula, so it gets a ' first. */
export function csvCell(value: string | number): string {
  const text = String(value)
  return csvField(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text)
}
