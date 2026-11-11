// PROJECT.md on disk: read it, note a decision, rewrite the Intent, Blocks or Open sections. Each change is one history
// entry by the author the caller names, so it is undone like any file edit; the file is created with its four empty
// sections by the first change when it is missing.
import { resolve } from "node:path"
import { inProjectQueue, readIfThere, writeNew, writeWithHistory } from "./file-writes.js"
import { assertMeta, type Author, type HistoryEntry } from "./history.js"
import { appendToSection, EMPTY_PROJECT, oneLine, PROJECT_PATH, withSection, type ProjectSection } from "./project-text.js"

export interface ProjectBlock {
  name: string
  does: string
  status: string
}

export interface ProjectUpdate {
  intent?: string | undefined
  blocks?: readonly ProjectBlock[] | undefined
  open?: readonly string[] | undefined
}

/** PROJECT.md's text, or undefined when the project has none yet. */
export function readProject(root: string): Promise<string | undefined> {
  return readIfThere(resolve(root, PROJECT_PATH))
}

/** "2026-11-11" in UTC. */
const day = (now: Date) => now.toISOString().slice(0, 10)

/** Refuses text that would start a section of its own. */
function plain(text: string, what: string): string {
  if (/^#{1,6}\s/m.test(text)) throw new Error(`The ${what} cannot contain a Markdown heading (a line starting with #). Nothing was written.`)
  return text
}

export const blockLine = (block: ProjectBlock) => `- ${oneLine(block.name)}: ${oneLine(block.does)} (${oneLine(block.status)})`

/** The sections an update rewrites, with their new bodies. */
function sectionsOf(update: ProjectUpdate): [ProjectSection, string][] {
  const out: [ProjectSection, string][] = []
  if (update.intent !== undefined) out.push(["Intent", plain(update.intent, "intent")])
  if (update.blocks !== undefined) out.push(["Blocks", update.blocks.map(blockLine).join("\n")])
  if (update.open !== undefined) out.push(["Open", update.open.map((item) => `- ${plain(oneLine(item), "open item")}`).join("\n")])
  return out
}

/** Writes `change(text)` as one history entry, creating the file from the empty sections when it is missing. */
function changeProject(root: string, change: (text: string) => string, meta: { author: Author; summary: string }): Promise<HistoryEntry> {
  return inProjectQueue(root, async () => {
    assertMeta(meta)
    const path = resolve(root, PROJECT_PATH)
    const source = await readIfThere(path)
    const after = change(source ?? EMPTY_PROJECT)
    if (source === undefined) return writeNew(root, path, after, meta)
    if (after === source) throw new Error(`${PROJECT_PATH} already says this. Nothing was written.`)
    return writeWithHistory(root, { path, source, file: PROJECT_PATH }, after, { ...meta, file: PROJECT_PATH, before: source, after })
  })
}

/** Adds "- 2026-11-11 text" at the end of Decisions. */
export async function noteDecision(root: string, text: string, meta: { author: Author; now?: Date }): Promise<HistoryEntry> {
  const line = oneLine(text)
  if (line === "") throw new Error("The decision is empty. Nothing was written.")
  plain(line, "decision")
  const entry = `- ${day(meta.now ?? new Date())} ${line}`
  return changeProject(root, (source) => appendToSection(source, "Decisions", entry), { author: meta.author, summary: `Note decision: ${line}` })
}

/** Rewrites the sections the update names (Intent, Blocks, Open) as one change. */
export async function setProject(root: string, update: ProjectUpdate, meta: { author: Author }): Promise<HistoryEntry> {
  const sections = sectionsOf(update)
  if (sections.length === 0) throw new Error("Give intent, blocks or open. Nothing was written.")
  const change = (source: string) => sections.reduce((text, [section, body]) => withSection(text, section, body), source)
  return changeProject(root, change, { author: meta.author, summary: `Set project ${sections.map(([s]) => s).join(", ")}` })
}
