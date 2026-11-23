// Modules from libraries, named <library>/<Name>. A library is laid out as the shelf is: <library>/modules/<Name>/
// when it has a folder modules, else <library>/<Name>/. A library's sheet enters a project only when it is proved plain
// (plain-sheet.ts); its parts come as data, and their component files are generated here. Only this person verifies:
// the marks are kept under the home folder, never read from a library.
import { createHash } from "node:crypto"
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { join, posix, sep } from "node:path"
import { parse, stringify } from "yaml"
import { z } from "zod"
import { footprintFromFile } from "../engine/footprints/file.js"
import { inProjectQueue, writeNew } from "./file-writes.js"
import { writeFileAtomic } from "./fs-utils.js"
import { copperflowHome } from "./home.js"
import { componentName, FOOTPRINT_FILE, generateComponent, PartSchema, PARTS_DIR, validatePartId, verificationTemplate, type Part } from "./library.js"
import { librarySources, whereFrom, type LibrarySource } from "./library-sources.js"
import { checkModuleName, MODULE_NAME, moduleDetails, partsFrom, type ShelfModule } from "./modules.js"
import { checkPlainSheet, type PlainSheet } from "./plain-sheet.js"
import { CARD_LIMITS, readCard } from "./sheet-card.js"
import { projectPath, resolveInRoot } from "./workspace.js"

const MarkSchema = z.object({ by: z.string(), at: z.string(), hash: z.string() })
const MarksSchema = z.object({ marks: z.record(z.string(), MarkSchema) })

interface LibraryModule extends ShelfModule {
  library: LibrarySource
  module: string
  folder: string
  parts: PartFiles[]
}

async function kind(path: string): Promise<"none" | "link" | "dir" | "file" | "other"> {
  try {
    const found = await lstat(path)
    if (found.isSymbolicLink()) return "link"
    return found.isDirectory() ? "dir" : found.isFile() ? "file" : "other"
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return "none"
    throw error
  }
}

/** A plain file's text, never through a link; `undefined` when there is none. */
async function plainFile(path: string, shown: string): Promise<string | undefined> {
  const found = await kind(path)
  if (found === "none") return undefined
  if (found !== "file") throw new Error(`${shown} is ${found === "link" ? "a link" : "not a plain file"}; copperflow does not follow links in a library`)
  return readFile(path, "utf8")
}

/** The folder a library keeps its modules in: modules/ when it has one, else the library's own folder. */
async function modulesDir(library: LibrarySource): Promise<string> {
  const root = await kind(library.root)
  if (root !== "dir") throw new Error(`The library ${library.name} (${library.root}) is ${root === "none" ? "not there" : root === "link" ? "a link" : "not a folder"}`)
  const inner = join(library.root, "modules")
  const found = await kind(inner)
  if (found === "none") return library.root
  if (found !== "dir") throw new Error(`The library ${library.name}'s modules is ${found === "link" ? "a link" : "not a folder"}`)
  return inner
}

/** A module's folder in a library, refused when it is a link or outside the library. */
async function moduleFolder(library: LibrarySource, name: string): Promise<string | undefined> {
  const dir = await modulesDir(library)
  const folder = join(dir, checkModuleName(name))
  const found = await kind(folder)
  if (found === "none") return undefined
  if (found !== "dir") throw new Error(`${library.name}/${name} is ${found === "link" ? "a link" : "not a folder"}; copperflow does not follow links in a library`)
  const [real, realRoot] = await Promise.all([realpath(folder), realpath(library.root)])
  if (!real.startsWith(realRoot + sep)) throw new Error(`${library.name}/${name} is outside the library`)
  return folder
}

const marksFile = () => join(copperflowHome(), "module-marks.json")

async function readMarks(): Promise<Record<string, z.infer<typeof MarkSchema>>> {
  const text = await readFile(marksFile(), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (text === undefined) return {}
  const parsed = MarksSchema.safeParse(JSON.parse(text))
  if (!parsed.success) throw new Error(`${marksFile()} is damaged; fix or delete it`)
  return parsed.data.marks
}

/** One imported part's files as the library holds them: the bytes use_module brings into a project. */
interface PartFiles {
  id: string
  yaml: string
  footprint?: string
}

/** The ids of the parts a sheet imports: from the plain check, else from each `./parts/<id>/…` import's text. */
function importedIds(text: string): string[] {
  let ids: string[]
  try {
    ids = checkPlainSheet(text).parts.map((part) => part.id)
  } catch {
    ids = [...text.matchAll(/from\s+["']\.\/parts\/([^/"']+)\//g)].map((found) => found[1] as string)
  }
  return [...new Set(ids)].sort()
}

/** A folder or file of a module, refused unless it is plain (not a link) and its real path is inside the module's. */
async function insideModule(realModule: string, path: string, want: "dir" | "file", shown: string): Promise<boolean> {
  const found = await kind(path)
  if (found === "none") return false
  if (found !== want) throw new Error(`${shown} is ${found === "link" ? "a link" : `not a plain ${want === "dir" ? "folder" : "file"}`}; copperflow does not follow links in a library`)
  if (!(await realpath(path)).startsWith(realModule + sep)) throw new Error(`${shown} is outside the module`)
  return true
}

/**
 * The one reading of a module's parts, for its hash and for use_module alike: each part the sheet imports, in id
 * order, its part.yaml and, when part.yaml names it, its footprint.yaml. Anything that is a link or outside the
 * module, or an imported part the library does not hold, refuses the module.
 */
async function moduleParts(name: string, folder: string, text: string): Promise<PartFiles[]> {
  const ids = importedIds(text)
  if (ids.length === 0) return []
  const realModule = await realpath(folder)
  const partsDir = join(folder, PARTS_DIR)
  if (!(await insideModule(realModule, partsDir, "dir", `${name}/${PARTS_DIR}`))) throw new Error(`${name} does not hold part ${ids[0]}, which its sheet imports`)
  const found: PartFiles[] = []
  for (const id of ids) {
    const shown = `${name}/${PARTS_DIR}/${id}`
    validatePartId(id)
    const dir = join(partsDir, id)
    if (!(await insideModule(realModule, dir, "dir", shown))) throw new Error(`${name} does not hold part ${id}, which its sheet imports`)
    if (!(await insideModule(realModule, join(dir, "part.yaml"), "file", `${shown}/part.yaml`))) throw new Error(`${name} does not hold part ${id}: ${shown} has no part.yaml`)
    const yaml = await readFile(join(dir, "part.yaml"), "utf8")
    let named: unknown
    try {
      named = (parse(yaml) as { footprint?: unknown } | null)?.footprint
    } catch {
      throw new Error(`${shown}/part.yaml is not valid YAML`)
    }
    if (named !== FOOTPRINT_FILE) {
      found.push({ id, yaml })
      continue
    }
    if (!(await insideModule(realModule, join(dir, FOOTPRINT_FILE), "file", `${shown}/${FOOTPRINT_FILE}`))) throw new Error(`${shown} has no ${FOOTPRINT_FILE}, which its part.yaml names`)
    found.push({ id, yaml, footprint: await readFile(join(dir, FOOTPRINT_FILE), "utf8") })
  }
  return found
}

/** The hash a mark holds: the sheet's text, then for each imported part in id order its part.yaml and footprint.yaml. */
function moduleHash(text: string, parts: readonly PartFiles[]): string {
  const hash = createHash("sha256").update(`sheet\0${text}\0`)
  for (const part of parts) hash.update(`${part.id}/part.yaml\0${part.yaml}\0${part.id}/${FOOTPRINT_FILE}\0${part.footprint ?? ""}\0`)
  return hash.digest("hex")
}

const fromText = (library: LibrarySource) => `${library.name} (${library.kind})`

async function readLibraryModule(library: LibrarySource, name: string, folder: string, marks: Awaited<ReturnType<typeof readMarks>>): Promise<LibraryModule | undefined> {
  const text = await plainFile(join(folder, `${name}.sheet.tsx`), `${library.name}/${name}/${name}.sheet.tsx`)
  if (text === undefined) return undefined
  const full = `${library.name}/${name}`
  const mark = marks[full]
  const parts = await moduleParts(full, folder, text)
  const verified = mark !== undefined && mark.hash === moduleHash(text, parts)
  return { name: full, text, card: readCard(text), library, module: name, folder, parts, from: fromText(library), ...(verified ? { verifiedBy: mark.by } : {}) }
}

/** Every module of a library; what is not a module (a link, a file, a bad name) is left out. */
export async function modulesOf(library: LibrarySource): Promise<LibraryModule[]> {
  const dir = await modulesDir(library)
  const marks = await readMarks()
  const found: LibraryModule[] = []
  for (const entry of (await readdir(dir)).sort()) {
    if (!MODULE_NAME.test(entry) || (await kind(join(dir, entry))) !== "dir") continue
    const module = await moduleFolder(library, entry)
      .then((folder) => (folder === undefined ? undefined : readLibraryModule(library, entry, folder, marks)))
      .catch(() => undefined)
    if (module) found.push(module)
  }
  return found
}

/** The modules of every library that can be read, library by library. */
export async function allLibraryModules(): Promise<LibraryModule[]> {
  const found: LibraryModule[] = []
  for (const library of await librarySources()) found.push(...(await modulesOf(library).catch(() => [])))
  return found
}

/** `team/Input`: the library and the module, each a plain name. */
async function findModule(full: string): Promise<LibraryModule> {
  const parts = full.split("/")
  if (parts.length !== 2) throw new Error(`"${full}" is not a module name: <Name> on the shelf, or <library>/<Name>`)
  const [libraryName, name] = [checkModuleName(parts[0]), checkModuleName(parts[1])]
  const library = (await librarySources()).find((item) => item.name === libraryName)
  if (library === undefined) throw new Error(`There is no library ${libraryName}; list_modules shows what there is`)
  const folder = await moduleFolder(library, name)
  const module = folder === undefined ? undefined : await readLibraryModule(library, name, folder, await readMarks())
  if (module === undefined) throw new Error(`The library ${libraryName} has no module ${name}; list_modules shows what there is`)
  return module
}

function plainOrWhy(text: string): PlainSheet | string {
  try {
    return checkPlainSheet(text)
  } catch (error) {
    return (error as Error).message
  }
}

export async function libraryModuleInfo(full: string): Promise<string> {
  const module = await findModule(full)
  const plain = plainOrWhy(module.text)
  return [
    ...moduleDetails(module.name, module),
    `From: library ${module.library.name}, ${whereFrom(module.library)}`,
    typeof plain === "string" ? `Not usable: ${plain}; use_module refuses it` : "Plain: use_module can bring it into a project",
  ].join("\n")
}

interface PartWrite {
  id: string
  files: { path: string; text: string }[]
}

/** A part brought as data: part.yaml checked and written again, footprint.yaml checked, the component generated here. */
function partAsData(module: LibraryModule, id: string): PartWrite {
  const shown = `${module.name}/${PARTS_DIR}/${id}`
  const held = module.parts.find((part) => part.id === id)
  if (held === undefined) throw new Error(`${module.name} does not hold part ${id}, which its sheet imports`)
  const yaml = held.yaml
  let data: unknown
  try {
    data = parse(yaml)
  } catch {
    throw new Error(`${shown}/part.yaml is not valid YAML`)
  }
  const parsed = PartSchema.safeParse(data)
  if (!parsed.success) throw new Error(`${shown}/part.yaml is not a part: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`)
  // A library's claim that a part is verified counts for nothing here.
  const { verified: _ignored, ...part } = parsed.data
  const files = [{ path: `${PARTS_DIR}/${id}/part.yaml`, text: stringify(part) }]
  let footprint: string | undefined
  if (part.footprint === FOOTPRINT_FILE) {
    footprint = held.footprint
    if (footprint === undefined) throw new Error(`${shown} has no ${FOOTPRINT_FILE}, which its part.yaml names`)
    const checked = footprintFromFile(`${shown}/${FOOTPRINT_FILE}`, footprint)
    if ("error" in checked) throw new Error(checked.error)
    files.push({ path: `${PARTS_DIR}/${id}/${FOOTPRINT_FILE}`, text: footprint })
  }
  files.push({ path: `${PARTS_DIR}/${id}/${componentName(id)}.tsx`, text: generateComponent(id, part as Part) })
  files.push({ path: `${PARTS_DIR}/${id}/verification.md`, text: verificationTemplate(id, part as Part, footprint) })
  return { id, files }
}

/** The parts a plain sheet imports that the project does not have yet, as data, refused on any mismatch. */
async function partsToBring(root: string, module: LibraryModule, plain: PlainSheet): Promise<PartWrite[]> {
  const writes: PartWrite[] = []
  for (const { id, component } of plain.parts) {
    validatePartId(id)
    if (component !== componentName(id)) throw new Error(`${module.name} imports ${component} from ${PARTS_DIR}/${id}, but that part's component is ${componentName(id)}`)
    if (writes.some((write) => write.id === id) || (await kind(resolveInRoot(root, `${PARTS_DIR}/${id}`))) !== "none") continue
    writes.push(partAsData(module, id))
  }
  return writes
}

const commitText = (library: LibrarySource) => (library.commit ? `, commit ${library.commit.slice(0, 12)}` : "")

/** Brings a library's module into the project: its sheet once proved plain, its parts as data, with a history entry. */
export async function useLibraryModule(root: string, request: { module: string; file: string }): Promise<string> {
  const circuit = projectPath(root, request.file)
  const module = await findModule(request.module)
  const plain = plainOrWhy(module.text)
  if (typeof plain === "string") throw new Error(`${module.name} cannot be used: ${plain}. Nothing was written`)
  if (plain.name !== module.module) throw new Error(`${module.name} cannot be used: its sheet is the function ${plain.name}, not ${module.module}. Nothing was written`)
  const place = posix.dirname(circuit) === "." ? "" : posix.dirname(circuit)
  const sheetFile = posix.join(place, `${module.module}.sheet.tsx`)
  const text = partsFrom(module.text, place)
  return inProjectQueue(root, async () => {
    const parts = await partsToBring(root, module, plain)
    const target = resolveInRoot(root, sheetFile)
    const there = await kind(target)
    if (there !== "none" && (there !== "file" || (await readFile(target, "utf8")) !== text)) {
      throw new Error(`${sheetFile} is already in the project and is not this module's sheet; rename one of them, or use the one there`)
    }
    const made: string[] = []
    try {
      for (const part of parts) {
        made.push(resolveInRoot(root, `${PARTS_DIR}/${part.id}`))
        for (const file of part.files) {
          const path = resolveInRoot(root, file.path)
          await mkdir(join(path, ".."), { recursive: true })
          await writeFileAtomic(path, file.text)
        }
      }
      const brought = parts.length === 0 ? "" : `; parts ${parts.map((part) => part.id).join(", ")} as data, components generated here`
      const summary = `use_module ${module.name}: ${module.module}.sheet.tsx from library ${module.library.name}, ${whereFrom(module.library)}${commitText(module.library)}${brought}`
      if (there === "none") await writeNew(root, target, text, { author: "ai", summary })
    } catch (error) {
      for (const folder of made) await rm(folder, { recursive: true, force: true })
      throw error
    }
    const ports = module.card.ports.map((port) => port.name).join(", ")
    const status = module.verifiedBy ? `verified by ${module.verifiedBy}` : "NOT verified"
    return `Copied ${module.module}.sheet.tsx into the project from library ${module.library.name} (${status}). Add it with edit_circuit: add_instance { sheet: "${module.module}", name, connections: { ${ports} } }`
  })
}

/** A person's mark on a library module, kept under the home folder with the hash of the sheet and its parts. */
export async function verifyLibraryModule(full: string, by: string, now: string): Promise<void> {
  if (by.trim() === "" || by.length > CARD_LIMITS.carries) throw new Error("--by names the person who checked the module")
  const module = await findModule(full)
  const marks = await readMarks()
  const next = { ...marks, [module.name]: { by: by.trim(), at: now, hash: moduleHash(module.text, module.parts) } }
  await mkdir(copperflowHome(), { recursive: true })
  await writeFile(marksFile(), `${JSON.stringify({ marks: next }, null, 2)}\n`)
}

/** list_modules (with or without name) and use_module for any module: <Name> on the shelf, <library>/<Name> in a library. */
export const isLibraryName = (name: unknown): name is string => typeof name === "string" && name.includes("/")
