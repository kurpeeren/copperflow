import { readdir, readFile, stat } from "node:fs/promises"
import { join, resolve } from "node:path"

export const MAX_PROJECT_BYTES = 32 * 1024 * 1024
const MAX_PROJECT_FILES = 5000
const SOURCE_FILE = /\.(tsx|ts|jsx|js|mjs|cjs|json)$/
const SKIPPED_DIRS = new Set(["node_modules", "dist", "coverage"])
const SKIPPED_FILES = new Set(["package-lock.json"])

/** A folder the walk does not enter: hidden, build output or dependencies. */
const skippedDir = (name: string): boolean => name.startsWith(".") || SKIPPED_DIRS.has(name)

/** A file the walk takes: a source or JSON file, or one `include` names by its relative path. */
const wantedFile = (name: string, relative: string, include: RegExp | undefined): boolean =>
  !name.startsWith(".") && !SKIPPED_FILES.has(name) && (SOURCE_FILE.test(name) || include?.test(relative) === true)

/**
 * Whether collectProjectFiles with this `include` would take the file at `relative` (forward
 * slashes, relative to the root), so a watcher can tell which changes a build reads.
 */
export function isProjectFile(relative: string, include?: RegExp): boolean {
  const parts = relative.split("/")
  const name = parts.pop() ?? ""
  return parts.every((dir) => !skippedDir(dir)) && wantedFile(name, relative, include)
}

/**
 * The project's source and JSON files, keyed by path relative to the root with forward
 * slashes. `include` adds files whose relative path matches, beyond the source and JSON files.
 * Symbolic links are not followed.
 */
export async function collectProjectFiles(
  root: string,
  limits: { maxBytes?: number; maxFiles?: number; include?: RegExp } = {},
): Promise<Record<string, string>> {
  const maxBytes = limits.maxBytes ?? MAX_PROJECT_BYTES
  const maxFiles = limits.maxFiles ?? MAX_PROJECT_FILES
  const files: Record<string, string> = {}
  let bytes = 0
  let count = 0
  const tooLarge = () => new Error("The project is too large to build")
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!skippedDir(entry.name)) await walk(path, `${prefix}${entry.name}/`)
        continue
      }
      const relative = `${prefix}${entry.name}`
      if (!entry.isFile() || !wantedFile(entry.name, relative, limits.include)) continue
      bytes += (await stat(path)).size
      count += 1
      if (bytes > maxBytes || count > maxFiles) throw tooLarge()
      files[relative] = await readFile(path, "utf8")
    }
  }
  await walk(resolve(root), "")
  return files
}
