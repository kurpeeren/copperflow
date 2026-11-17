// Where libraries of modules come from: the one that ships with copperflow (library/ at the package root, named
// copperflow), clones of git repositories under <home>/libraries/<name>/, and folders read where they are. The record
// of sources is <home>/libraries.json, outside every clone. Adding, updating and removing are a person's commands.
import { randomBytes } from "node:crypto"
import { lstat, mkdir, readFile, realpath, rename, rm, stat } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join, resolve, sep } from "node:path"
import { z } from "zod"
import { writeFileAtomic } from "./fs-utils.js"
import { checkGitAddress, checkRef, isGitAddress, runGit, ADDRESS_FORMS, type GitOptions } from "./git.js"
import { copperflowHome } from "./home.js"
import { checkModuleName } from "./modules.js"

export const BUILT_IN = "copperflow"
const TAKEN = new Set([BUILT_IN, "shelf"])
const SHORT_COMMIT = 7

const RecordSchema = z.object({
  name: z.string(),
  kind: z.enum(["git", "folder"]),
  /** The git address, or the folder's real path. */
  from: z.string(),
  ref: z.string().optional(),
  commit: z.string().optional(),
  added: z.string(),
  updated: z.string().optional(),
})
const RecordsSchema = z.object({ libraries: z.array(RecordSchema) })
type SourceRecord = z.infer<typeof RecordSchema>

export interface LibrarySource {
  name: string
  kind: "built in" | "git" | "folder"
  /** The folder the library is read from. */
  root: string
  from: string
  ref?: string
  commit?: string
  added?: string
  updated?: string
}

export interface LibraryChange {
  now: string
  /** The folder a relative folder source is named from (the command's folder). */
  base?: string
  ref?: string
  git?: GitOptions
}

/** The built-in library: COPPERFLOW_BUILTIN_LIBRARY (tests), else library/ beside dist/ in the package. */
export function builtInLibraryDir(env: NodeJS.ProcessEnv = process.env): string {
  const chosen = env["COPPERFLOW_BUILTIN_LIBRARY"]
  return chosen !== undefined && chosen !== "" ? chosen : fileURLToPath(new URL("../../library", import.meta.url))
}

const clonesDir = () => join(copperflowHome(), "libraries")
const recordsFile = () => join(copperflowHome(), "libraries.json")
/** A folder that never exists, given to git as its hooks folder so no hook runs. */
const noHooks = () => join(copperflowHome(), "libraries", ".no-hooks")

export function checkLibraryName(name: unknown): string {
  const checked = checkModuleName(name)
  if (TAKEN.has(checked.toLowerCase())) throw new Error(`"${checked}" is taken: ${[...TAKEN].join(" and ")} name the built-in library and the shelf`)
  return checked
}

async function readRecords(): Promise<SourceRecord[]> {
  let text: string
  try {
    text = await readFile(recordsFile(), "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  const parsed = RecordsSchema.safeParse(JSON.parse(text))
  if (!parsed.success) throw new Error(`${recordsFile()} is damaged; fix or delete it`)
  return parsed.data.libraries
}

async function writeRecords(records: readonly SourceRecord[]): Promise<void> {
  await mkdir(copperflowHome(), { recursive: true })
  await writeFileAtomic(recordsFile(), `${JSON.stringify({ libraries: records }, null, 2)}\n`)
}

const isDir = (path: string) => stat(path).then((found) => found.isDirectory(), () => false)

/** A clone's folder, refused when it is a link or not a plain folder inside the clones folder. */
async function cloneFolder(name: string): Promise<string> {
  const folder = join(clonesDir(), checkModuleName(name))
  const found = await lstat(folder).catch(() => undefined)
  if (!found?.isDirectory() || found.isSymbolicLink()) throw new Error(`The clone of ${name} (${folder}) is not a plain folder; remove the library and add it again`)
  const [real, realClones] = await Promise.all([realpath(folder), realpath(clonesDir())])
  if (!real.startsWith(realClones + sep)) throw new Error(`The clone of ${name} is outside ${clonesDir()}`)
  return folder
}

function source(record: SourceRecord): LibrarySource {
  const root = record.kind === "git" ? join(clonesDir(), record.name) : record.from
  return { ...record, root }
}

/** Every library: the built-in one when it is there, then the ones a person added, in the order added. */
export async function librarySources(): Promise<LibrarySource[]> {
  const builtIn = builtInLibraryDir()
  const first: LibrarySource[] = (await isDir(builtIn)) ? [{ name: BUILT_IN, kind: "built in", root: builtIn, from: builtIn }] : []
  return [...first, ...(await readRecords()).map(source)]
}

const short = (commit: string | undefined) => (commit ?? "").slice(0, SHORT_COMMIT)

/** `git https://…, ref main at 1a2b3c4` or `folder /path`. */
export function whereFrom(library: LibrarySource): string {
  if (library.kind === "built in") return `built in (${library.root})`
  if (library.kind === "folder") return `folder ${library.from}`
  return `git ${library.from}, ref ${library.ref ?? "?"} at ${short(library.commit)}`
}

async function cloneInto(name: string, address: string, change: LibraryChange): Promise<{ ref: string; commit: string }> {
  await mkdir(clonesDir(), { recursive: true })
  const temporary = join(clonesDir(), `.${name}-${randomBytes(6).toString("hex")}`)
  const place = { noHooks: noHooks() }
  try {
    const branch = change.ref === undefined ? [] : ["--branch", change.ref]
    await runGit(["clone", "--depth", "1", "--single-branch", "--no-recurse-submodules", "--no-tags", "--template=", ...branch, "--", address, temporary], place, change.git)
    const inside = { ...place, cwd: temporary }
    const ref = change.ref ?? (await runGit(["rev-parse", "--abbrev-ref", "HEAD"], inside, change.git))
    const commit = await runGit(["rev-parse", "HEAD"], inside, change.git)
    await rename(temporary, join(clonesDir(), name))
    return { ref, commit }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}

/** Adds a library from a git address (cloned) or a folder (read where it is); answers what was added. */
export async function addLibrary(name: string, where: string, change: LibraryChange): Promise<LibrarySource> {
  checkLibraryName(name)
  if (change.ref !== undefined) checkRef(change.ref)
  const records = await readRecords()
  if (records.some((record) => record.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is a library ${name} already; remove it first, or choose another name`)
  let record: SourceRecord
  if (where.startsWith("-") || where.includes("::") || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(where) || /^[^/\\]*@[^/\\]*:/.test(where) || isGitAddress(where)) {
    checkGitAddress(where)
    if ((await lstat(join(clonesDir(), name)).catch(() => undefined)) !== undefined) throw new Error(`${join(clonesDir(), name)} is there already; delete it, or choose another name`)
    const { ref, commit } = await cloneInto(name, where, change)
    record = { name, kind: "git", from: where, ref, commit, added: change.now }
  } else {
    if (change.ref !== undefined) throw new Error("--ref is for a git address; a folder is read as it is")
    const folder = await realpath(resolve(change.base ?? ".", where)).catch(() => undefined)
    if (folder === undefined || !(await isDir(folder))) throw new Error(`"${where}" is neither a folder nor a git address (${ADDRESS_FORMS})`)
    record = { name, kind: "folder", from: folder, added: change.now }
  }
  await writeRecords([...records, record])
  return source(record)
}

async function updateOne(record: SourceRecord, change: LibraryChange): Promise<{ text: string; record: SourceRecord }> {
  if (record.kind === "folder") return { text: `${record.name} is a folder, read where it is; there is nothing to update`, record }
  const folder = await cloneFolder(record.name)
  const place = { noHooks: noHooks(), cwd: folder }
  await runGit(["fetch", "--depth", "1", "--no-recurse-submodules", "--no-tags", "origin", checkRef(record.ref ?? "HEAD")], place, change.git)
  await runGit(["reset", "--hard", "--no-recurse-submodules", "FETCH_HEAD"], place, change.git)
  const commit = await runGit(["rev-parse", "HEAD"], place, change.git)
  const text = commit === record.commit ? `${record.name}: already at ${short(commit)}` : `${record.name}: updated from ${short(record.commit)} to ${short(commit)}`
  return { text, record: { ...record, commit, updated: change.now } }
}

/** Brings one git library, or every one, to the newest commit of its ref. */
export async function updateLibraries(name: string | undefined, change: LibraryChange): Promise<string> {
  const records = await readRecords()
  if (name !== undefined && !records.some((record) => record.name === name)) {
    throw new Error(name === BUILT_IN ? "The built-in library comes with copperflow; it updates with copperflow" : `There is no library ${name}; copperflow library lists them`)
  }
  const lines: string[] = []
  const next: SourceRecord[] = []
  for (const record of records) {
    if (name !== undefined && record.name !== name) {
      next.push(record)
      continue
    }
    const done = await updateOne(record, change)
    lines.push(done.text)
    next.push(done.record)
    await writeRecords([...next, ...records.slice(next.length)])
  }
  return lines.length === 0 ? "No libraries to update" : lines.join("\n")
}

/** Forgets a library; a clone is deleted, a folder never. */
export async function removeLibrary(name: string): Promise<string> {
  const records = await readRecords()
  const record = records.find((item) => item.name === name)
  if (record === undefined) throw new Error(name === BUILT_IN ? "The built-in library comes with copperflow and cannot be removed" : `There is no library ${name}; copperflow library lists them`)
  if (record.kind === "git") await rm(await cloneFolder(name), { recursive: true, force: true })
  await writeRecords(records.filter((item) => item !== record))
  return record.kind === "git" ? `Forgot ${name} and deleted its clone` : `Forgot ${name}; the folder stays where it is`
}
