// verification.md read as ticks: each "- [ ]" or "- [x]" line is an item, addressed by its text. A tick changes the
// one character between the brackets and leaves every other byte of the file as it was. Ticks count only while the
// file's "Content:" line names the part's current content hash: a part changed since then has every item open. Pure.

const ITEM = /^- \[([ xX])\] (.*?)\r?$/
const CONTENT = /^Content: ([0-9a-f]{12})\b/m
/** The characters of the content hash the "Content:" line shows. */
const SHOWN = 12

export interface ChecklistItem {
  text: string
  ticked: boolean
}

export function checklistItems(text: string): ChecklistItem[] {
  return text.split("\n").flatMap((line) => {
    const match = ITEM.exec(line)
    return match ? [{ text: match[2] ?? "", ticked: match[1] !== " " }] : []
  })
}

/** The content hash the file names (its first 12 characters), or undefined when it has no "Content:" line. */
export function checklistContent(text: string): string | undefined {
  return CONTENT.exec(text)?.[1]
}

/** Whether the file's ticks belong to the part whose content hash is `hash`. */
export function ticksCurrent(text: string, hash: string): boolean {
  return checklistContent(text) === hash.slice(0, SHOWN)
}

/** The items still to tick for the part with this content hash: every item when the part changed since the ticks. */
export function openItems(text: string, hash: string): string[] {
  const current = ticksCurrent(text, hash)
  return checklistItems(text)
    .filter((item) => !current || !item.ticked)
    .map((item) => item.text)
}

/** The file with the named items ticked (or unticked); the names not found are returned instead, and nothing changes. */
export function withTicks(text: string, items: readonly string[], ticked: boolean): { text: string } | { missing: string[] } {
  const lines = text.split("\n")
  const wanted = new Set(items)
  const found = new Set<string>()
  const changed = lines.map((line) => {
    const match = ITEM.exec(line)
    const name = match?.[2]
    // Two lines with the same text are one item: both take the tick.
    if (name === undefined || !wanted.has(name)) return line
    found.add(name)
    return `${line.slice(0, 3)}${ticked ? "x" : " "}${line.slice(4)}`
  })
  const missing = items.filter((item) => !found.has(item))
  return missing.length > 0 ? { missing } : { text: changed.join("\n") }
}

/** The file with every item unticked and its "Content:" line naming `hash`, the rest unchanged. */
export function withoutTicks(text: string, hash: string): string {
  return text
    .split("\n")
    .map((line) => (ITEM.test(line) ? `${line.slice(0, 3)} ${line.slice(4)}` : line))
    .join("\n")
    .replace(CONTENT, `Content: ${hash.slice(0, SHOWN)}`)
}
