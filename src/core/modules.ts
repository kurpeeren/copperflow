// The shelf: a person's own folder of modules, outside any project. A module is a folder <Name>/ holding
// <Name>.sheet.tsx, the library parts it uses under parts/<id>/, where it was saved from (module.json) and, once a
// person has checked it, the mark verified.json with a hash of the sheet's text. Nothing here follows a link or takes
// a name that could reach outside the shelf folder or the project.
import { createHash } from "node:crypto"
import { copyFile, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join, posix, sep } from "node:path"
import { scanCircuit } from "./analyze.js"
import { PART_ID } from "./pin-types.js"
import { PARTS_DIR } from "./library.js"
import { cardGaps, CARD_LIMITS, portText, readCard, type SheetCardText } from "./sheet-card.js"
import { caseText } from "../engine/sim/cases.js"
import { lastCaseResult } from "./case-results.js"
import { projectPath, resolveCircuit, resolveInRoot } from "./workspace.js"

/** A module's name: a letter, then letters, digits, "_" and "-". It is a folder name, so nothing else. */
export const MODULE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
/** Names Windows keeps for devices, which no folder may have. */
const DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i
/** A sheet's name is its tag in a circuit: a capital letter, then letters, digits and "_". */
const SHEET_NAME = /^[A-Z][A-Za-z0-9_]*$/
const SHEET_FILE = /\.sheet\.tsx$/
/** A library part's import in a sheet: `…/parts/<id>/<Component>`. */
const PART_IMPORT = /(?:^|\/)parts\/([^/]+)\/([A-Za-z_][A-Za-z0-9_]*)$/
const LIST_LIMIT = 60
const LINE_LIMIT = 200

export interface ModuleOrigin {
  savedFrom: string
  savedAt: string
}

interface VerifiedMark {
  by: string
  at: string
  hash: string
}

/** The shelf folder: COPPERFLOW_MODULES, else .copperflow/modules in the home folder. */
export function shelfDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const chosen = env["COPPERFLOW_MODULES"]
  return chosen !== undefined && chosen !== "" ? chosen : join(homedir(), ".copperflow", "modules")
}

export function checkModuleName(name: unknown): string {
  if (typeof name !== "string" || !MODULE_NAME.test(name) || DEVICE_NAME.test(name)) {
    throw new Error(`"${String(name)}" is not a module name: a letter, then letters, digits, "_" and "-" (at most 64)`)
  }
  return name
}

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex")

async function kind(path: string): Promise<"none" | "link" | "dir" | "file" | "other"> {
  try {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) return "link"
    return stat.isDirectory() ? "dir" : stat.isFile() ? "file" : "other"
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "none"
    throw error
  }
}

/** The folder of a module on the shelf, refused when it is a link or not inside the shelf; `undefined` when there is none. */
async function moduleFolder(name: string): Promise<string | undefined> {
  const shelf = shelfDir()
  const folder = join(shelf, checkModuleName(name))
  const found = await kind(folder)
  if (found === "none") return undefined
  if (found !== "dir") throw new Error(`The shelf's ${name} is ${found === "link" ? "a link" : "not a folder"}; copperflow does not follow links on the shelf`)
  const [real, realShelf] = await Promise.all([realpath(folder), realpath(shelf)])
  if (!real.startsWith(realShelf + sep)) throw new Error(`The shelf's ${name} is outside the shelf folder`)
  return folder
}

async function existingModule(name: string): Promise<string> {
  const folder = await moduleFolder(name)
  if (folder === undefined) throw new Error(`There is no module ${name} on the shelf; list_modules shows what there is`)
  return folder
}

/** A regular file of a module, never a link. */
async function readModuleFile(folder: string, file: string): Promise<string | undefined> {
  const path = join(folder, file)
  const found = await kind(path)
  if (found === "none") return undefined
  if (found !== "file") throw new Error(`${basename(folder)}/${file} is not a plain file; copperflow does not follow links on the shelf`)
  return readFile(path, "utf8")
}

/** Copies a folder's plain files and folders; a link anywhere is refused before it is read. */
async function copyTree(from: string, to: string, shown: string): Promise<void> {
  await mkdir(to, { recursive: true })
  for (const entry of await readdir(from)) {
    const found = await kind(join(from, entry))
    if (found === "dir") await copyTree(join(from, entry), join(to, entry), `${shown}/${entry}`)
    else if (found === "file") await copyFile(join(from, entry), join(to, entry))
    else throw new Error(`${shown}/${entry} is ${found === "link" ? "a link" : "not a plain file"}; only plain files are copied`)
  }
}

/** The library parts a sheet imports, by id, and any other import it has. */
function sheetImports(text: string): { parts: Map<string, string>; others: string[] } {
  const parts = new Map<string, string>()
  const others: string[] = []
  for (const spec of scanCircuit(text).model.imports) {
    const found = PART_IMPORT.exec(spec.source)
    if (found && PART_ID.test(found[1] as string) && spec.source.startsWith(".")) parts.set(spec.source, found[1] as string)
    else others.push(spec.source)
  }
  return { parts, others }
}

/** The text with each library import pointing at `parts/<id>/` as seen from `folder` (project-relative, "" for the root). */
export function partsFrom(text: string, folder: string): string {
  let out = text
  for (const [source, id] of sheetImports(text).parts) {
    const component = source.slice(source.lastIndexOf("/") + 1)
    let target = posix.relative(folder, `${PARTS_DIR}/${id}/${component}`)
    if (!target.startsWith(".")) target = `./${target}`
    out = out.split(`"${source}"`).join(`"${target}"`)
  }
  return out
}

/** The sheet's name in its `export default function <Name>()`, renamed. */
function renamed(text: string, from: string, to: string): string {
  return from === to ? text : text.replace(new RegExp(`(export\\s+default\\s+function\\s+)${from}\\b`), `$1${to}`)
}

export interface SaveRequest {
  file: string
  name?: string
  replace?: boolean
}

/** Copies a project's sheet and its library parts to the shelf; `build` returns the sheet's errors (none when it builds). */
export async function saveModule(root: string, request: SaveRequest, build: (file: string) => Promise<string[]>): Promise<string> {
  const file = projectPath(root, request.file)
  if (!SHEET_FILE.test(file)) throw new Error(`${request.file} is not a sheet file (<Name>.sheet.tsx)`)
  const sheet = basename(file).replace(SHEET_FILE, "")
  const name = checkModuleName(request.name ?? sheet)
  if (!SHEET_NAME.test(name)) throw new Error(`${name} cannot name a sheet: start with a capital letter and use letters, digits and "_"`)
  const text = await readFile((await resolveCircuit(root, file)).path, "utf8")
  const gaps = cardGaps(readCard(text))
  if (gaps.length > 0) throw new Error(`${file} is missing ${gaps.join(", ")}; a port needs a type or what it carries. Write them with describe_sheet, then save again`)
  const { parts, others } = sheetImports(text)
  if (others.length > 0) throw new Error(`${file} imports ${others.join(", ")}; a module is one sheet with library parts only`)
  const errors = await build(file)
  if (errors.length > 0) throw new Error(`${file} does not build: ${errors.slice(0, 3).join("; ")}`)
  const folder = await moduleFolder(name)
  if (folder !== undefined && !request.replace) throw new Error(`The shelf has a module ${name} already; pass replace: true to overwrite it, or another name`)
  const target = join(shelfDir(), name)
  // Every part folder is checked before anything is written.
  for (const id of new Set(parts.values())) {
    if ((await kind(resolveInRoot(root, `${PARTS_DIR}/${id}`))) !== "dir") throw new Error(`${file} uses parts/${id}, which is not a plain folder in the project`)
  }
  if (folder !== undefined) await rm(folder, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  for (const id of new Set(parts.values())) await copyTree(resolveInRoot(root, `${PARTS_DIR}/${id}`), join(target, PARTS_DIR, id), `${PARTS_DIR}/${id}`)
  await writeFile(join(target, `${name}.sheet.tsx`), renamed(partsFrom(text, ""), sheet, name))
  const origin: ModuleOrigin = { savedFrom: join(root, file), savedAt: new Date().toISOString() }
  await writeFile(join(target, "module.json"), `${JSON.stringify(origin, null, 2)}\n`)
  const kept = parts.size === 0 ? "" : ` with parts ${[...new Set(parts.values())].join(", ")}`
  return `Saved ${name} to the shelf${kept}. It is NOT verified: only a person verifies it (copperflow modules verify ${name} --by <name>).`
}

export interface ShelfModule {
  name: string
  text: string
  card: SheetCardText
  verifiedBy?: string
  origin?: ModuleOrigin
  /** Where a library's module is from, as its line says it: `team (git)`. */
  from?: string
}

async function readModule(name: string, folder: string): Promise<ShelfModule | undefined> {
  const text = await readModuleFile(folder, `${name}.sheet.tsx`)
  if (text === undefined) return undefined
  const mark = await readModuleFile(folder, "verified.json").then((raw) => (raw === undefined ? undefined : (JSON.parse(raw) as VerifiedMark)), () => undefined)
  const origin = await readModuleFile(folder, "module.json").then((raw) => (raw === undefined ? undefined : (JSON.parse(raw) as ModuleOrigin)), () => undefined)
  return { name, text, card: readCard(text), ...(mark?.hash === hashOf(text) ? { verifiedBy: mark.by } : {}), ...(origin ? { origin } : {}) }
}

/** Every module on the shelf, by name; what is not a module (a link, a file, a bad name) is left out. */
async function shelfModules(): Promise<ShelfModule[]> {
  const shelf = shelfDir()
  if ((await kind(shelf)) === "none") return []
  const found: ShelfModule[] = []
  for (const entry of (await readdir(shelf)).sort()) {
    if (!MODULE_NAME.test(entry) || DEVICE_NAME.test(entry) || (await kind(join(shelf, entry))) !== "dir") continue
    const module = await readModule(entry, join(shelf, entry)).catch(() => undefined)
    if (module) found.push(module)
  }
  return found
}

const partLines = (text: string) => scanCircuit(text).model.parts.filter((part) => part.tag !== "port")
const status = (module: ShelfModule) => (module.verifiedBy ? `verified by ${module.verifiedBy}` : "NOT verified")

/** `Input: 24 V digital input …; ports IN (input, …), GND (ground); 4 parts; NOT verified`, at most 200 characters. */
export function moduleLine(module: ShelfModule): string {
  const tail = `; ${partLines(module.text).length} parts; ${status(module)}${module.from ? `; from ${module.from}` : ""}`
  const ports = module.card.ports.map(portText).join(", ")
  const head = `${module.name}: ${module.card.does ?? "(does not say what it does)"}; ports ${ports || "none"}`
  const room = LINE_LIMIT - tail.length
  return `${head.length > room ? `${head.slice(0, room - 1)}…` : head}${tail}`
}

const cardText = (module: ShelfModule) => [
  module.card.does ?? "",
  ...(module.card.sources ?? []),
  ...module.card.ports.flatMap((port) => [port.name, port.type ?? "", port.carries ?? ""]),
]

/** One line a module, at most 60: the shelf, then `libraries`; `filter` matches the name (with its library) and the card's text. */
export async function listModules(filter?: string, libraries: readonly ShelfModule[] = []): Promise<string> {
  const all = [...(await shelfModules()), ...libraries]
  const needle = filter?.toLowerCase() ?? ""
  const hit = (module: ShelfModule) => [module.name, ...cardText(module)].some((text) => text.toLowerCase().includes(needle))
  const shown = all.filter(hit)
  if (shown.length === 0) return all.length === 0 ? `The shelf (${shelfDir()}) has no modules yet. save_module puts a described sheet there.` : `No modules match ${filter}.`
  const more = shown.length - LIST_LIMIT
  return [...shown.slice(0, LIST_LIMIT).map(moduleLine), ...(more > 0 ? [`… and ${more} more (narrow with filter)`] : [])].join("\n")
}

const VALUE_PROPS = ["resistance", "capacitance", "inductance", "value", "frequency", "color"]

/** The card, the ports, the parts with values and footprints and the sources; not the code. */
export function moduleDetails(name: string, module: ShelfModule): string[] {
  const library = new Map([...sheetImports(module.text).parts.entries()].map(([source, id]) => [source.slice(source.lastIndexOf("/") + 1), id]))
  const parts = partLines(module.text).map((part) => {
    const value = VALUE_PROPS.map((key) => part.props[key]?.literal).find((literal) => literal !== undefined)
    const footprint = part.props["footprint"]?.literal
    const what = library.has(part.tag) ? `part ${library.get(part.tag)}` : part.tag
    return `  ${[part.name, what, value, footprint].filter((item) => item !== undefined).join(" ")}`
  })
  return [
    `${name}: ${status(module)}`,
    `Does: ${module.card.does ?? "(not written)"}`,
    ...module.card.ports.map((port) => `  port ${portText(port)}`),
    ...caseLines(name, module.card),
    `Parts (${parts.length}):`,
    ...parts,
    ...(module.card.sources ? [`Sources: ${module.card.sources.join("; ")}`] : []),
  ]
}

/** One line a case, with its last result in this session (simulate with the sheet runs them). */
function caseLines(name: string, card: SheetCardText): string[] {
  const sheet = name.slice(name.lastIndexOf("/") + 1)
  return (card.cases ?? []).map((one) => {
    const last = lastCaseResult(sheet, one.name)
    const result = last === undefined ? "not run in this session" : last.passed ? "passed" : last.text.slice(0, 120)
    return `  case ${caseText(one)} (last run: ${result})`
  })
}

/** A shelf module's details and where and when it was saved. */
export async function moduleInfo(name: string): Promise<string> {
  const folder = await existingModule(name)
  const module = await readModule(name, folder)
  if (!module) throw new Error(`The shelf's ${name} has no ${name}.sheet.tsx`)
  return [
    ...moduleDetails(name, module),
    module.origin ? `Saved from ${module.origin.savedFrom} on ${module.origin.savedAt.slice(0, 10)}` : "Saved from: not recorded",
  ].join("\n")
}

/** Copies a module's sheet beside the circuit `file` (and its parts the project has not), and says how to place it. */
export async function useModule(root: string, request: { module: string; file: string }): Promise<string> {
  const name = checkModuleName(request.module)
  const circuit = projectPath(root, request.file)
  const folder = await existingModule(name)
  const module = await readModule(name, folder)
  if (!module) throw new Error(`The shelf's ${name} has no ${name}.sheet.tsx`)
  const place = posix.dirname(circuit) === "." ? "" : posix.dirname(circuit)
  const sheetFile = posix.join(place, `${name}.sheet.tsx`)
  const target = resolveInRoot(root, sheetFile)
  const text = partsFrom(module.text, place)
  const there = await kind(target)
  if (there !== "none" && (there !== "file" || (await readFile(target, "utf8")) !== text)) {
    throw new Error(`${sheetFile} is already in the project and is not this module's sheet; rename one of them, or use the one there`)
  }
  for (const id of new Set(sheetImports(module.text).parts.values())) {
    const into = resolveInRoot(root, `${PARTS_DIR}/${id}`)
    if ((await kind(into)) !== "none") continue
    const from = join(folder, PARTS_DIR, id)
    if ((await kind(from)) !== "dir") throw new Error(`The module ${name} has no plain folder parts/${id}`)
    await copyTree(from, into, `${name}/${PARTS_DIR}/${id}`)
  }
  if (there === "none") await writeFile(target, text)
  const ports = module.card.ports.map((port) => port.name).join(", ")
  return `Copied ${name}.sheet.tsx into the project. Add it with edit_circuit: add_instance { sheet: "${name}", name, connections: { ${ports} } }`
}

/** A person's mark: who checked the module, when, and the hash of the sheet they checked. */
export async function verifyModule(name: string, by: string, now: string): Promise<void> {
  if (by.trim() === "" || by.length > CARD_LIMITS.carries) throw new Error("--by names the person who checked the module")
  const folder = await existingModule(name)
  const text = await readModuleFile(folder, `${name}.sheet.tsx`)
  if (text === undefined) throw new Error(`The shelf's ${name} has no ${name}.sheet.tsx`)
  const mark: VerifiedMark = { by: by.trim(), at: now, hash: hashOf(text) }
  await writeFile(join(folder, "verified.json"), `${JSON.stringify(mark, null, 2)}\n`)
}

export async function removeModule(name: string): Promise<void> {
  await rm(await existingModule(name), { recursive: true, force: true })
}
