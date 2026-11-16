import { cp, lstat, mkdir, readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/** The skills as they ship: `skills/` beside `dist` in the package (and beside `src` in the source tree). */
const SHIPPED = fileURLToPath(new URL("../skills", import.meta.url))

/** The skills by folder name: how to work in a project, and how to plan a board before the first circuit file. */
const SKILLS = ["copperflow", "copperflow-plan"] as const

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

/** Whether `target` is already a skill folder; a link or a file in its place is refused. */
async function alreadyThere(target: string): Promise<boolean> {
  const there = await lstat(target).catch(() => undefined)
  if (there?.isSymbolicLink()) throw new Error(`${target} is a link; remove it and run this again`)
  if (there && !there.isDirectory()) throw new Error(`${target} is a file; remove it and run this again`)
  return there !== undefined
}

/**
 * Copies the copperflow skills into `.claude/skills` of the project (or of the home folder), where an agent that
 * reads skills finds them, and answers with one line saying where. Files of an earlier copy are replaced; other
 * skills in that folder are left alone. Every target is checked before anything is copied.
 */
export async function installSkill(options: InstallSkillOptions): Promise<string> {
  const base = options.global ? (options.home ?? homedir()) : options.cwd
  const folder = join(base, ".claude", "skills")
  const before: boolean[] = []
  for (const name of SKILLS) before.push(await alreadyThere(join(folder, name)))
  let files = 0
  for (const name of SKILLS) {
    await mkdir(join(folder, name), { recursive: true })
    await cp(join(SHIPPED, name), join(folder, name), { recursive: true, force: true })
    files += await countFiles(join(SHIPPED, name))
  }
  const verb = before.some(Boolean) ? "Updated" : "Installed"
  return `${verb} the copperflow skills (${SKILLS.join(", ")}; ${files} files) in ${folder}. Start a new agent session to load them.`
}
