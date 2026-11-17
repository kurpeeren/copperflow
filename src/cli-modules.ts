// copperflow modules: the shelf for a person. Listing, verifying (only here, at a real terminal) and removing.
import { allLibraryModules, isLibraryName, libraryModuleInfo, verifyLibraryModule } from "./core/library-modules.js"
import { listModules, moduleInfo, removeModule, verifyModule } from "./core/modules.js"

interface ModulesIO {
  out(text: string): void
  ask?(question: string): Promise<string>
}

const USAGE = 'Usage: copperflow modules [verify <name or library/name> --by "<your name>" | remove <name>]'

export async function modulesCommand(args: string[], io: ModulesIO, takeOption: (args: string[], option: string) => [string | undefined, string[]]): Promise<void> {
  const [action, ...rest] = args
  if (action === undefined) return io.out(await listModules(undefined, await allLibraryModules()))
  if (action === "remove") {
    const name = rest[0]
    if (name === undefined) throw new Error(USAGE)
    await removeModule(name)
    return io.out(`Removed ${name} from the shelf`)
  }
  if (action !== "verify") throw new Error(`Unknown modules command "${action}". ${USAGE}`)
  const [by, remaining] = takeOption(rest, "--by")
  const name = remaining[0]
  if (name === undefined || !by) throw new Error(USAGE)
  // A person confirms at a real terminal; an agent's shell is not interactive.
  if (!io.ask) throw new Error("modules verify must be run by a person in an interactive terminal")
  const library = isLibraryName(name)
  io.out(await (library ? libraryModuleInfo(name) : moduleInfo(name)))
  const answer = await io.ask(`Type ${name} to confirm you checked this module: its parts, its ports and what they carry: `)
  if (answer.trim() !== name) throw new Error(`Not verified: you typed "${answer.trim()}", not ${name}`)
  await (library ? verifyLibraryModule : verifyModule)(name, by, new Date().toISOString())
  io.out(`${name} is verified by ${by}`)
}
