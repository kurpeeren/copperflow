// Design → Add page, Rename page and Delete page: each is one edit of the circuit file (src/core/page-edits.ts), on the
// schematic page that is open. Delete is refused while the page has parts, as the core refuses it.
import type { Design, Edit } from "../api.js"
import { deletePageRefusal, nextPageName, pageNames, renamePageRefusal } from "./schematic-pages.js"

export const PAGE_COMMANDS = ["addPage", "renamePage", "deletePage"] as const
export type PageCommand = (typeof PAGE_COMMANDS)[number]

export interface PageCommandInput {
  design: Design | undefined
  /** The schematic page that is open. */
  page: string
  edit(edits: Edit[], summary: string): Promise<boolean>
  notify(text: string): void
  /** Asks for a name; null when the person cancels. */
  ask(question: string, initial: string): string | null
  /** Opens a schematic page. */
  openPage(page: string): void
}

/** A typed name, trimmed; undefined when cancelled, empty or unchanged. */
function typedName(input: PageCommandInput, question: string, initial: string): string | undefined {
  const typed = input.ask(question, initial)?.trim()
  return typed === undefined || typed === "" ? undefined : typed
}

async function addPage(input: PageCommandInput): Promise<void> {
  const name = typedName(input, "Name of the new page", nextPageName(pageNames(input.design)))
  if (name === undefined) return
  if (await input.edit([{ kind: "addPage", name }], `add page ${name}`)) input.openPage(name)
}

async function renamePage(input: PageCommandInput): Promise<void> {
  const refusal = renamePageRefusal(input.page)
  if (refusal) return input.notify(refusal)
  const name = typedName(input, `New name for page ${input.page}`, input.page)
  if (name === undefined || name === input.page) return
  if (await input.edit([{ kind: "renamePage", from: input.page, to: name }], `rename page ${input.page} to ${name}`)) input.openPage(name)
}

async function deletePage(input: PageCommandInput): Promise<void> {
  const refusal = deletePageRefusal(input.design, input.page)
  if (refusal) return input.notify(refusal)
  const index = pageNames(input.design).indexOf(input.page)
  const before = pageNames(input.design)[Math.max(0, index - 1)] ?? "Main"
  if (await input.edit([{ kind: "removePage", name: input.page }], `delete page ${input.page}`)) input.openPage(before)
}

/** Runs one page command. */
export function runPageCommand(command: PageCommand, input: PageCommandInput): Promise<void> {
  if (command === "addPage") return addPage(input)
  return command === "renamePage" ? renamePage(input) : deletePage(input)
}

/** The edits a schematic page sends: what it adds goes on that page; the first page, Main, is the board itself. */
export function onPage(edits: readonly Edit[], page: string): Edit[] {
  if (page === "Main") return [...edits]
  return edits.map((edit) => (edit.kind === "addPart" || edit.kind === "addDrawing" || edit.kind === "addTrace") && edit.page === undefined ? { ...edit, page } : edit)
}
