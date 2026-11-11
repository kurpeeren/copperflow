// PROJECT.md as text: the project's memory, written by the model and the person together. Four sections under "## "
// headings (Intent, Blocks, Decisions, Open). A change rewrites or appends to one section's body and leaves every other
// byte of the file as it was, so what a person wrote round the sections stays.

export const PROJECT_PATH = "PROJECT.md"
export const PROJECT_SECTIONS = ["Intent", "Blocks", "Decisions", "Open"] as const
export type ProjectSection = (typeof PROJECT_SECTIONS)[number]

/** The file a project starts with: a title and the four sections, empty. */
export const EMPTY_PROJECT = `# Project\n\n${PROJECT_SECTIONS.map((s) => `## ${s}\n\n`).join("")}`

/**
 * Where a section's body lies in the text: from after its heading line to the next "## " heading or the end. The
 * heading is found in any case ("## decisions"), and in a file with CRLF line ends.
 */
function bodyRange(text: string, section: ProjectSection): { start: number; end: number } | undefined {
  const heading = new RegExp(`^## ${section}[ \\t]*\\r?$`, "mi").exec(text)
  if (!heading) return undefined
  const lineEnd = text.indexOf("\n", heading.index)
  const start = lineEnd < 0 ? text.length : lineEnd + 1
  const next = /^## /m.exec(text.slice(start))
  return { start, end: next ? start + next.index : text.length }
}

/** A section's body, trimmed; empty when the section is missing. */
export function sectionText(text: string, section: ProjectSection): string {
  const range = bodyRange(text, section)
  return range ? text.slice(range.start, range.end).trim() : ""
}

/** The body as written into the file: a blank line, the content, a blank line before the next heading. */
const bodyOf = (content: string) => (content.trim() === "" ? "\n" : `\n${content.trim()}\n\n`)

/** The text with one section's body replaced; a missing section is added at the end. A CRLF file stays CRLF. */
export function withSection(text: string, section: ProjectSection, content: string): string {
  const crlf = text.includes("\r\n") && !/(^|[^\r])\n/.test(text)
  const plain = crlf ? text.replace(/\r\n/g, "\n") : text
  const range = bodyRange(plain, section)
  const lf = (body: string) => body.replace(/\r\n/g, "\n")
  let after: string
  if (range) after = plain.slice(0, range.start) + bodyOf(lf(content)) + plain.slice(range.end)
  else {
    const base = plain === "" || plain.endsWith("\n\n") ? plain : plain.endsWith("\n") ? `${plain}\n` : `${plain}\n\n`
    after = `${base}## ${section}\n${bodyOf(lf(content))}`
  }
  return crlf ? after.replace(/\n/g, "\r\n") : after
}

/** The text with one line added at the end of a section's body. */
export function appendToSection(text: string, section: ProjectSection, line: string): string {
  const now = sectionText(text, section)
  return withSection(text, section, now === "" ? line : `${now}\n${line}`)
}

/** The lines of a list section ("- " bullets), without the bullet. */
export function sectionLines(text: string, section: ProjectSection): string[] {
  return sectionText(text, section)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => line.replace(/^[-*]\s+/, ""))
}

/** One line of text: newlines become spaces, so a note cannot open a section of its own. */
export const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ").trim()
