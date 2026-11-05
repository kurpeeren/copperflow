import { readdir, readFile, stat } from "node:fs/promises"
import { join, resolve } from "node:path"

export const MAX_PROJECT_BYTES = 32 * 1024 * 1024
const MAX_PROJECT_FILES = 5000
const SOURCE_FILE = /\.(tsx|ts|jsx|js|mjs|cjs|json)$/
const SKIPPED_DIRS = new Set(["node_modules", "dist", "coverage"])
const SKIPPED_FILES = new Set(["package-lock.json"])

/**
 * The project's source and JSON files, keyed by path relative to the root with forward
 * slashes. Symbolic links are not followed.
 */
export async function collectProjectFiles(
  root: string,
  limits: { maxBytes?: number; maxFiles?: number } = {},
): Promise<Record<string, string>> {
  const maxBytes = limits.maxBytes ?? MAX_PROJECT_BYTES
  const maxFiles = limits.maxFiles ?? MAX_PROJECT_FILES
  const files: Record<string, string> = {}
  let bytes = 0
  let count = 0
  const tooLarge = () => new Error("The project is too large for the fast build")
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".")) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) await walk(path, `${prefix}${entry.name}/`)
        continue
      }
      if (!entry.isFile() || !SOURCE_FILE.test(entry.name) || SKIPPED_FILES.has(entry.name)) continue
      bytes += (await stat(path)).size
      count += 1
      if (bytes > maxBytes || count > maxFiles) throw tooLarge()
      files[`${prefix}${entry.name}`] = await readFile(path, "utf8")
    }
  }
  await walk(resolve(root), "")
  return files
}
