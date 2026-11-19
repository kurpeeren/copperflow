import { statSync } from "node:fs"
import { resolve } from "node:path"
import { cliCommandNames } from "../cli-help.js"

export type AppMode = { kind: "window"; open?: string } | { kind: "cli"; args: string[] }

const CIRCUIT_SUFFIX = ".circuit.tsx"
// Options copperflow's own command line knows. Any other "--switch" is Chromium's or Windows' and is not ours.
const OWN_OPTIONS = new Set(["--root", "--help", "-h", "--version"])

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * What one start of the app should do. `argv` is what the program was given after node's own first entry
 * (`process.argv.slice(1)` in the main process).
 *
 * What Electron puts in it:
 * - A packaged app: `[<exe path>, ...arguments]`. The first entry is the exe itself.
 * - `electron .` while developing: `[<electron.exe>, ".", ...arguments]`. The `.` is the app folder, not a project.
 * - Chromium switches such as `--allow-file-access-from-files`, `--no-sandbox` or `--inspect=5858` can sit anywhere,
 *   and Windows adds `--squirrel-*` flags when an installer starts the app. None of them are ours, so they are dropped
 *   (one of copperflow's own options is kept: --root, --help, -h, --version).
 * A project folder given as just "." is therefore taken as the development entry; pass a full path to open the
 * current folder.
 */
export function appMode(argv: string[]): AppMode {
  const entries = withoutLaunchEntries(argv)
  // Switches before the first real argument are dropped; after a command they are that command's own options.
  const start = entries.findIndex((arg) => !isForeignSwitch(arg))
  if (start === -1) return { kind: "window" }
  const args = entries.slice(start)
  const [first = "", ...others] = args
  if (cliCommandNames().includes(first) || OWN_OPTIONS.has(first)) return { kind: "cli", args }
  const target = others.filter((arg) => !isForeignSwitch(arg))
  if (target.length === 0 && (first.endsWith(CIRCUIT_SUFFIX) || isFolder(first))) return { kind: "window", open: resolve(first) }
  // Not a command and not something to open: the command line says so ("Unknown command ...") instead of a window
  // that silently ignores what was typed.
  return { kind: "cli", args }
}

function withoutLaunchEntries(argv: string[]): string[] {
  const [first, ...afterFirst] = argv
  const rest = first !== undefined && /\.exe$/i.test(first) ? afterFirst : argv
  return rest[0] === "." ? rest.slice(1) : rest
}

function isForeignSwitch(arg: string): boolean {
  if (!arg.startsWith("--")) return false
  return !OWN_OPTIONS.has(arg.split("=")[0] as string)
}
