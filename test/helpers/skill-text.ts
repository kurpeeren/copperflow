import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

export const SKILL_DIR = fileURLToPath(new URL("../../skills/copperflow", import.meta.url))

/** SKILL.md and every reference, by path relative to the skill folder. */
export async function skillFiles(): Promise<Record<string, string>> {
  const references = (await readdir(join(SKILL_DIR, "references"))).filter((name) => name.endsWith(".md")).sort()
  const paths = ["SKILL.md", ...references.map((name) => `references/${name}`)]
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await readFile(join(SKILL_DIR, path), "utf8")] as const)))
}

/** The whole skill as one text with its whitespace collapsed. */
export async function skillText(): Promise<string> {
  return Object.values(await skillFiles()).join("\n").replace(/\s+/g, " ")
}
