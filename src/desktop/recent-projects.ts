import { lstat, readFile, readdir, rename, stat } from "node:fs/promises"
import { basename, resolve } from "node:path"
import { writeFileAtomic } from "./atomic-write.js"

export interface RecentProject {
  root: string
  name: string
  /** When the folder was last opened in the app, as an ISO date. */
  opened: string
  /** Names of the *.circuit.tsx files directly in the folder, a few of them. */
  circuits: string[]
  /** The folder is gone (moved, deleted, a drive that is not there); the person decides whether to drop it. */
  missing: boolean
}

export const MAX_RECENT_PROJECTS = 12
export const MAX_LISTED_CIRCUITS = 5
const STORE_VERSION = 1
const CIRCUIT_SUFFIX = ".circuit.tsx"

interface StoredProject {
  root: string
  opened: string
}

/** Windows compares paths without regard to case, so the same folder typed two ways is one entry there. */
function sameFolderKey(root: string): string {
  const resolved = resolve(root)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function isStoredProject(value: unknown): value is StoredProject {
  if (typeof value !== "object" || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.root === "string" && typeof entry.opened === "string"
}

/** The store as read: its projects, and whether this program may write it back. */
interface ReadStore {
  projects: StoredProject[]
  /** False for a store a newer copperflow wrote: its format is not known here, so it is never overwritten. */
  writable: boolean
}

/** A free `<file>.broken-<time>` name: an earlier damaged store kept aside is never overwritten. */
async function brokenName(file: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  for (let n = 1; ; n++) {
    const name = `${file}.broken-${stamp}${n === 1 ? "" : `-${n}`}`
    try {
      await lstat(name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return name
      throw error
    }
  }
}

/** The stored list, or none: the parsed file when it is ours, undefined when it is damaged or not a store. */
function parseStore(text: string): ReadStore | undefined {
  let parsed: { version?: unknown; projects?: unknown }
  try {
    parsed = JSON.parse(text) as typeof parsed
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null) return undefined
  if (typeof parsed.version === "number" && parsed.version > STORE_VERSION) return { projects: [], writable: false }
  if (!Array.isArray(parsed.projects)) return undefined
  return { projects: parsed.projects.filter(isStoredProject), writable: true }
}

async function readStore(file: string): Promise<ReadStore> {
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { projects: [], writable: true }
    throw error
  }
  const store = parseStore(text)
  if (store !== undefined) return store
  // The file is not ours or was damaged. Keep it aside so nothing is lost, and start with an empty list.
  await rename(file, await brokenName(file))
  return { projects: [], writable: true }
}

async function circuitsIn(root: string): Promise<string[] | undefined> {
  try {
    if (!(await stat(root)).isDirectory()) return undefined
    const names = await readdir(root)
    return names.filter((name) => name.endsWith(CIRCUIT_SUFFIX)).sort().slice(0, MAX_LISTED_CIRCUITS)
  } catch {
    // A folder that cannot be read is shown as missing: the person can remove it from the list.
    return undefined
  }
}

async function describe(stored: StoredProject): Promise<RecentProject> {
  const circuits = await circuitsIn(stored.root)
  return { root: stored.root, name: basename(stored.root) || stored.root, opened: stored.opened, circuits: circuits ?? [], missing: circuits === undefined }
}

export interface RecentProjects {
  list(): Promise<RecentProject[]>
  add(root: string): Promise<RecentProject[]>
  remove(root: string): Promise<RecentProject[]>
}

/** The list of recently opened project folders, kept in a small JSON file the caller chooses. */
export function recentProjects(storeFile: string): RecentProjects {
  // Calls run one after another, so two quick adds cannot overwrite each other's file.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work)
    queue = result.catch(() => undefined)
    return result
  }
  // A store a newer copperflow wrote is not written: the list is answered as it would be, and the file stays as it is.
  const save = async (store: ReadStore, projects: StoredProject[]): Promise<RecentProject[]> => {
    if (store.writable) await writeFileAtomic(storeFile, `${JSON.stringify({ version: STORE_VERSION, projects }, null, 2)}\n`)
    return Promise.all(projects.map(describe))
  }
  const without = (projects: StoredProject[], root: string) => projects.filter((entry) => sameFolderKey(entry.root) !== sameFolderKey(root))
  return {
    list: () => serial(async () => Promise.all((await readStore(storeFile)).projects.map(describe))),
    add: (root) =>
      serial(async () => {
        const store = await readStore(storeFile)
        return save(store, [{ root: resolve(root), opened: new Date().toISOString() }, ...without(store.projects, root)].slice(0, MAX_RECENT_PROJECTS))
      }),
    remove: (root) =>
      serial(async () => {
        const store = await readStore(storeFile)
        return save(store, without(store.projects, root))
      }),
  }
}
