// The system's git, started with an argument list and never through a shell, for libraries kept in git. Only https,
// ssh and scp-like addresses are passed, always after "--"; no hooks run, no submodules are fetched, and git never
// stops to ask for a password.
import { spawn } from "node:child_process"

/** How git is started; tests point it at a local repository through `env` (see test/libraries.test.ts). */
export interface GitOptions {
  command?: string
  env?: Readonly<Record<string, string>>
}

const HTTPS = /^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(:\d{1,5})?\/[^\s\\]+$/
const SSH = /^ssh:\/\/([A-Za-z0-9][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9.-]*(:\d{1,5})?\/[^\s\\]+$/
const SCP = /^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*:[^\s\\:-][^\s\\]*$/
/** A branch or tag: no leading "-", no "..", nothing git reads as an option or a range. */
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/
const GIT_FAILED_LINES = 2

export const ADDRESS_FORMS = "https://…, ssh://… or user@host:path"

/** Whether the text is written as a git address copperflow accepts; anything else is not passed to git. */
export function isGitAddress(address: string): boolean {
  return !address.startsWith("-") && !address.includes("::") && [HTTPS, SSH, SCP].some((form) => form.test(address))
}

/** Refuses what git could read as an option, another protocol (ext::, file://) or a local path. */
export function checkGitAddress(address: string): string {
  if (!isGitAddress(address)) throw new Error(`"${address.slice(0, 120)}" is not a git address copperflow accepts: ${ADDRESS_FORMS}`)
  return address
}

export function checkRef(ref: string): string {
  if (!REF.test(ref) || ref.includes("..") || ref.endsWith(".lock") || ref.endsWith("/")) throw new Error(`"${ref.slice(0, 120)}" is not a branch or tag name`)
  return ref
}

/** Settings given to every git command: no hooks, no submodules, no external transport. */
function safety(noHooks: string): string[] {
  return ["-c", `core.hooksPath=${noHooks}`, "-c", "protocol.ext.allow=never", "-c", "submodule.recurse=false", "-c", "core.fsmonitor=false"]
}

/** Runs git with these arguments; answers its output, or throws with the first lines git wrote. */
export function runGit(args: readonly string[], place: { noHooks: string; cwd?: string }, options: GitOptions = {}): Promise<string> {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "https:ssh", ...options.env }
  return new Promise((resolve, reject) => {
    const child = spawn(options.command ?? "git", [...safety(place.noHooks), ...args], { cwd: place.cwd, shell: false, windowsHide: true, env, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    let err = ""
    child.stdout.on("data", (chunk: Buffer) => void (out += chunk.toString("utf8")))
    child.stderr.on("data", (chunk: Buffer) => void (err += chunk.toString("utf8")))
    child.on("error", (error: NodeJS.ErrnoException) => {
      reject(error.code === "ENOENT" ? new Error("git is not installed (or not on the PATH); install git to add a library from a git address.") : error)
    })
    child.on("close", (code) => {
      if (code === 0) return resolve(out.trim())
      const said = err.split("\n").map((line) => line.trim()).filter((line) => line !== "").slice(0, GIT_FAILED_LINES).join(" ")
      reject(new Error(`git ${args[0] ?? ""} failed: ${said || `exit code ${code}`}`))
    })
  })
}
