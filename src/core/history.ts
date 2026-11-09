import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"

const EntrySchema = z.object({
  id: z.string().regex(/^c\d{4,}$/),
  time: z.string(),
  author: z.enum(["ai", "human"]),
  /** Project-relative path with forward slashes. */
  file: z.string(),
  summary: z.string(),
  before: z.string(),
  after: z.string(),
  /** Set on entries that undo an earlier entry. */
  undoOf: z.string().optional(),
  /** Set on entries that redo an earlier undo: the undo's id. A redo is an ordinary change, which can be undone. */
  redoOf: z.string().optional(),
})

export type HistoryEntry = z.infer<typeof EntrySchema>
export type Author = HistoryEntry["author"]

export interface HistoryListing extends Omit<HistoryEntry, "before" | "after"> {
  /** A later undo took this change back, and no redo has brought it back since. */
  undone: boolean
  /**
   * The redo that brought this back. On an undo, the redo that took it back; on a change that was undone, the redo it
   * lives on as now, at the end of its chain of undos and redos.
   */
  redoneAs?: string
}

/** Who took each entry back: the undo of each change, and the redo of each undo. */
interface Links {
  undoneBy: ReadonlyMap<string, string>
  redoneBy: ReadonlyMap<string, string>
}

function linksOf(entries: readonly HistoryEntry[]): Links {
  const undoneBy = new Map<string, string>()
  const redoneBy = new Map<string, string>()
  for (const entry of entries) {
    if (entry.undoOf) undoneBy.set(entry.undoOf, entry.id)
    if (entry.redoOf) redoneBy.set(entry.redoOf, entry.id)
  }
  return { undoneBy, redoneBy }
}

/** The end of a change's chain of undos and redos when that is a redo in effect; ids grow along it, so a crafted loop ends. */
function livesOn(links: Links, id: string): string | undefined {
  let current = id
  for (;;) {
    const undo = links.undoneBy.get(current)
    if (!undo) return current === id ? undefined : current
    const redo = links.redoneBy.get(undo)
    if (!redo || idNumber(redo) <= idNumber(current)) return undefined
    current = redo
  }
}

/** For a change that was undone and then redone, and is in effect again: the redo it lives on as. */
export function livesOnAs(entries: readonly HistoryEntry[], id: string): string | undefined {
  return livesOn(linksOf(entries), id)
}

function listing(entry: Omit<HistoryEntry, "before" | "after">, links: Links): HistoryListing {
  const redoneAs = entry.undoOf ? links.redoneBy.get(entry.id) : livesOn(links, entry.id)
  const undone = links.undoneBy.has(entry.id) && redoneAs === undefined
  return redoneAs ? { ...entry, undone, redoneAs } : { ...entry, undone }
}

const ENTRY_FILE = /^c(\d{4,})\.json$/

export function historyDir(root: string): string {
  return join(root, ".copperflow", "history")
}

/** Stores an entry under the next id after the highest one (c0001, c0002, ...). */
export async function recordEntry(
  root: string,
  data: Omit<HistoryEntry, "id" | "time">,
  now: Date = new Date(),
): Promise<HistoryEntry> {
  const dir = historyDir(root)
  await mkdir(dir, { recursive: true })
  for (let attempt = 0; attempt < 20; attempt++) {
    const next = Math.max(0, ...(await entryIds(root)).map(idNumber)) + 1
    const entry: HistoryEntry = { id: `c${String(next).padStart(4, "0")}`, time: now.toISOString(), ...data }
    try {
      await writeFile(join(dir, `${entry.id}.json`), JSON.stringify(entry), { flag: "wx" })
      return entry
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
  }
  throw new Error("Could not allocate a history id; another process keeps writing history")
}

export async function removeEntry(root: string, id: string): Promise<void> {
  await rm(join(historyDir(root), `${EntrySchema.shape.id.parse(id)}.json`), { force: true })
}

/** All entries, oldest first. Throws, naming the file, when an entry is damaged. */
export async function readEntries(root: string): Promise<HistoryEntry[]> {
  return Promise.all((await entryIds(root)).map((id) => readEntry(root, id)))
}

/** The newest entries first, without file contents. */
export async function listEntries(root: string, limit: number): Promise<HistoryListing[]> {
  const entries = await readEntries(root)
  const links = linksOf(entries)
  return entries
    .slice(-limit)
    .reverse()
    .map(({ before: _before, after: _after, ...rest }) => listing(rest, links))
}

async function readEntry(root: string, id: string): Promise<HistoryEntry> {
  const name = `${id}.json`
  try {
    const entry = EntrySchema.parse(JSON.parse(await readFile(join(historyDir(root), name), "utf8")))
    if (entry.id !== id) throw new Error(`its id is ${entry.id}`)
    return entry
  } catch (error) {
    throw new Error(`${name} in .copperflow/history is not a valid history entry: ${(error as Error).message}`)
  }
}

/** Entry ids from file names only, in numeric order (c9999 before c10000). */
async function entryIds(root: string): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(historyDir(root))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  return names
    .filter((name) => ENTRY_FILE.test(name))
    .map((name) => name.slice(0, -".json".length))
    .sort((a, b) => idNumber(a) - idNumber(b))
}

function idNumber(id: string): number {
  return Number(id.slice(1))
}
