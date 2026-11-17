// copperflow library: the libraries of modules, for a person. Adding, updating and removing are commands only; no
// tool does them, because a person decides which libraries they trust.
import { modulesOf } from "./core/library-modules.js"
import { addLibrary, librarySources, removeLibrary, updateLibraries, whereFrom, type LibraryChange, type LibrarySource } from "./core/library-sources.js"

const USAGE = "Usage: copperflow library [add <name> <git address or folder> [--ref <branch or tag>] | update [name] | remove <name>]"

async function count(library: LibrarySource): Promise<string> {
  try {
    const found = (await modulesOf(library)).length
    return `${found} module${found === 1 ? "" : "s"}`
  } catch (error) {
    return `cannot be read: ${(error as Error).message}`
  }
}

const day = (time: string | undefined) => (time ?? "").slice(0, 10)

/** `team: git https://…, ref main at 1a2b3c4; 3 modules; added 2026-11-17, updated 2026-11-18`. */
async function line(library: LibrarySource): Promise<string> {
  const dates = library.added === undefined ? "" : `; added ${day(library.added)}${library.updated ? `, updated ${day(library.updated)}` : ""}`
  return `${library.name}: ${whereFrom(library)}; ${await count(library)}${dates}`
}

/** Adds a library and answers `Added <name>: <where from>; <n> modules`. */
export async function libraryAdd(name: string, where: string, change: LibraryChange): Promise<string> {
  const added = await addLibrary(name, where, change)
  return `Added ${added.name}: ${whereFrom(added)}; ${await count(added)}`
}

export const libraryUpdate = updateLibraries

export async function libraryCommand(root: string, args: string[], out: (text: string) => void, takeOption: (args: string[], option: string) => [string | undefined, string[]]): Promise<void> {
  const [action, ...rest] = args
  const now = new Date().toISOString()
  if (action === undefined) {
    const sources = await librarySources()
    if (sources.length === 0) return out("No libraries. Add one: copperflow library add <name> <git address or folder>")
    const lines: string[] = []
    for (const library of sources) lines.push(await line(library))
    return out(lines.join("\n"))
  }
  if (action === "add") {
    const [ref, remaining] = takeOption(rest, "--ref")
    const [name, where, extra] = remaining
    if (name === undefined || where === undefined || extra !== undefined) throw new Error(USAGE)
    return out(await libraryAdd(name, where, { now, base: root, ...(ref === undefined ? {} : { ref }) }))
  }
  if (action === "update") {
    if (rest.length > 1) throw new Error(USAGE)
    return out(await updateLibraries(rest[0], { now }))
  }
  if (action === "remove") {
    if (rest[0] === undefined || rest.length > 1) throw new Error(USAGE)
    return out(await removeLibrary(rest[0]))
  }
  throw new Error(`Unknown library command "${action}". ${USAGE}`)
}
