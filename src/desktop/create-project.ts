import { mkdir, readdir, rm, stat } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { createCircuitFile } from "../core/index.js"
import { boardSkeleton } from "../core/netlist.js"
import { DEFAULT_BOARD } from "../core/new-circuit.js"

// Characters Windows refuses in a file name, plus the separators of every system.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_NAME = /[<>:"/\\|?*\u0000-\u001f]/
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const MAX_NAME_LENGTH = 100
/** Below Windows' 260-character path limit, with room for the files written beside the circuit. */
const MAX_CIRCUIT_PATH_LENGTH = 250

/** Writes the starter circuit `circuit` into the project folder `root`. */
export type StarterWriter = (root: string, circuit: string) => Promise<unknown>

function checkName(name: string): void {
  if (name.trim() === "") throw new Error("Give the project a name.")
  if (name !== name.trim()) throw new Error("A project name cannot start or end with a space.")
  if (FORBIDDEN_NAME.test(name)) throw new Error('A project name cannot contain \\ / : * ? " < > | or control characters.')
  if (name.endsWith(".")) throw new Error("A project name cannot be a dot or end with one.")
  if (RESERVED_NAMES.test(name)) throw new Error(`"${name}" is a name Windows keeps for itself; choose another.`)
  if (name.length > MAX_NAME_LENGTH) throw new Error(`A project name can have at most ${MAX_NAME_LENGTH} characters.`)
}

/** The parent must be a full path to a folder that is there: a mistyped one is refused, never made. */
async function checkParent(parentDir: string): Promise<void> {
  if (!isAbsolute(parentDir)) throw new Error(`The folder for the project must be a full path; ${parentDir} is not.`)
  let isFolder: boolean
  try {
    isFolder = (await stat(parentDir)).isDirectory()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`The folder ${parentDir} does not exist.`)
    throw error
  }
  if (!isFolder) throw new Error(`${parentDir} is not a folder.`)
}

/** The circuit file's name: the project name as a file name stem, lower case, words joined by dashes. */
function circuitFileName(name: string): string {
  const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return `${stem || "main"}.circuit.tsx`
}

/** Makes the project folder; answers whether this call made it (false for an empty folder that was there). */
async function makeEmptyFolder(root: string): Promise<boolean> {
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    await mkdir(root)
    return true
  }
  if (entries.length > 0) throw new Error(`The folder ${root} already exists and is not empty.`)
  return false
}

/** The same call the Studio makes for "new empty circuit": generating a netlist refuses a circuit without parts. */
const writeStarter: StarterWriter = (root, circuit) => {
  const { width, height } = DEFAULT_BOARD
  return createCircuitFile(root, circuit, boardSkeleton(DEFAULT_BOARD), { author: "human", summary: `create ${circuit} (empty, ${width} × ${height} mm board)` })
}

/**
 * Makes `<parentDir>/<name>` with an empty starter circuit (a board of the default size, no parts) and answers its
 * place. When the circuit cannot be written, a folder this call made is removed again, so the same name can be retried.
 */
export async function createProject(parentDir: string, name: string, write: StarterWriter = writeStarter): Promise<{ root: string; circuit: string }> {
  checkName(name)
  await checkParent(parentDir)
  const root = join(parentDir, name)
  const circuit = circuitFileName(name)
  const path = join(root, circuit)
  if (path.length > MAX_CIRCUIT_PATH_LENGTH) {
    throw new Error(`The path ${path} is too long (${path.length} characters; at most ${MAX_CIRCUIT_PATH_LENGTH}). Choose a shorter name or a folder nearer the top of the drive.`)
  }
  const made = await makeEmptyFolder(root)
  try {
    await write(root, circuit)
  } catch (error) {
    if (made) await removeMadeFolder(root, error)
    throw error
  }
  return { root, circuit }
}

/** Takes back the folder a failed creation made; when that fails too, the error names both. */
async function removeMadeFolder(root: string, cause: unknown): Promise<void> {
  try {
    await rm(root, { recursive: true, force: true })
  } catch (error) {
    throw new Error(`${(cause as Error).message} The folder ${root} could not be removed again (${(error as Error).message}); remove it before trying the same name.`, { cause })
  }
}
