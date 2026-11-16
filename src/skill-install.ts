import { cp, lstat, mkdir, readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/** The skill as it ships: `skills/copperflow` beside `dist` in the package (and beside `src` in the source tree). */
const SHIPPED_SKILL = fileURLToPath(new URL("../skills/copperflow", import.meta.url))

export interface InstallSkillOptions {
  /** The project folder. */
  cwd: string
  /** Install under the home folder, for every project, instead of under the project. */
  global?: boolean
  /** The home folder; the user's own by default. */
  home?: string
}

/** How many files are under `folder`. */
async function countFiles(folder: string): Promise<number> {
  const entries = await readdir(folder, { withFileTypes: true, recursive: true })
  return entries.filter((entry) => entry.isFile()).length
}

/**
 * Copies the copperflow skill into `.claude/skills/copperflow` of the project (or of the home folder), where an agent
 * that reads skills finds it, and answers with one line saying where. Files of an earlier copy are replaced.
 */
export async function installSkill(options: InstallSkillOptions): Promise<string> {
  const base = options.global ? (options.home ?? homedir()) : options.cwd
  const target = join(base, ".claude", "skills", "copperflow")
  const there = await lstat(target).catch(() => undefined)
  if (there?.isSymbolicLink()) throw new Error(`${target} is a link; remove it and run this again`)
  if (there && !there.isDirectory()) throw new Error(`${target} is a file; remove it and run this again`)
  await mkdir(target, { recursive: true })
  await cp(SHIPPED_SKILL, target, { recursive: true, force: true })
  return `${there ? "Updated" : "Installed"} the copperflow skill in ${target} (${await countFiles(SHIPPED_SKILL)} files). Start a new agent session to load it.`
}
