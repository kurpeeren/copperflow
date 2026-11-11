// The Project tab's view of PROJECT.md, as plain functions so it can be tested without a DOM: the title and every
// "## " section in file order, each as its lines. The tab only shows the file; edits go through the file itself.

export interface MemorySection {
  title: string
  lines: string[]
}

export type MemoryView = { kind: "missing"; note: string } | { kind: "file"; title: string; sections: MemorySection[] }

export const MISSING_NOTE = "No PROJECT.md yet. The agent writes it with set_project and note_decision; you can also write it by hand at the project root."

/** The lines of a section body: blank lines dropped, list bullets kept as the text after them. */
const bodyLines = (body: string[]) => body.map((line) => line.trim()).filter((line) => line !== "").map((line) => line.replace(/^[-*]\s+/, ""))

export function memoryView(text: string | null | undefined): MemoryView {
  if (text === null || text === undefined) return { kind: "missing", note: MISSING_NOTE }
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const title = lines.find((line) => /^# /.test(line))?.slice(2).trim() || "Project"
  const sections: MemorySection[] = []
  let current: { title: string; body: string[] } | undefined
  for (const line of lines) {
    const heading = /^## (.*)$/.exec(line)
    if (heading) {
      if (current) sections.push({ title: current.title, lines: bodyLines(current.body) })
      current = { title: (heading[1] ?? "").trim(), body: [] }
    } else if (current) current.body.push(line)
  }
  if (current) sections.push({ title: current.title, lines: bodyLines(current.body) })
  return { kind: "file", title, sections }
}
