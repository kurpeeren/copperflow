// guide: the copperflow skill over MCP, for clients that do not install skills or read resources by themselves.
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { packagesText } from "../core/packages.js"

/** The skill's folder: skills/copperflow beside src/ and dist/. */
const SKILL_DIR = new URL("../../skills/copperflow/", import.meta.url)

/** The references by name. A topic is only ever looked up here, so it can never name another file. */
export const GUIDE_TOPICS: Readonly<Record<string, string>> = {
  planning: "references/planning.md",
  "design-workflow": "references/design-workflow.md",
  copper: "references/copper.md",
  "writing-circuits": "references/writing-circuits.md",
  "parts-library": "references/parts-library.md",
  "design-rules": "references/design-rules.md",
  "editable-subset": "references/editable-subset.md",
  modules: "references/modules.md",
  "redraw-from-image": "references/redraw-from-image.md",
}

/** The topic made from the footprint catalogue at call time, not read from a file; words after it narrow the list. */
export const PACKAGES_TOPIC = "packages"

export const guideInput = {
  topic: z.string().max(100).optional().describe(`One of ${Object.keys(GUIDE_TOPICS).join(", ")}, or ${PACKAGES_TOPIC} [words]: the footprint strings`),
  again: z.boolean().optional().describe("Answer a text already read in full"),
}

export const GUIDE_DESCRIPTION =
  "Read how to design with these tools: no topic gives the copperflow skill (SKILL.md), a topic one reference. A text already read answers a short line unless again. Call it when the skill is not installed."

/** The most argument sets one session remembers having answered. */
export const GUIDE_MEMORY_LIMIT = 32

/** The argument sets (as keys) one MCP session has been answered; session state only, the oldest forgotten past the limit. */
export interface GuideMemory {
  readonly size: number
  has(key: string): boolean
  remember(key: string): void
}

export function createGuideMemory(): GuideMemory {
  const keys = new Set<string>()
  return {
    get size() {
      return keys.size
    },
    has: (key) => keys.has(key),
    remember(key) {
      keys.delete(key)
      keys.add(key)
      while (keys.size > GUIDE_MEMORY_LIMIT) keys.delete(keys.values().next().value as string)
    },
  }
}

/** The search words after "packages" in a topic, or undefined when the topic is not the packages one. */
function packageWords(topic: string | undefined): string[] | undefined {
  const [first, ...words] = (topic ?? "").trim().split(/\s+/)
  return first?.toLowerCase() === PACKAGES_TOPIC ? words : undefined
}

/** The skill file a topic names, as a URL inside the skill folder. */
export function guideFile(topic?: string): URL | undefined {
  if (topic === undefined || topic === "") return new URL("SKILL.md", SKILL_DIR)
  const relative = Object.hasOwn(GUIDE_TOPICS, topic) ? GUIDE_TOPICS[topic] : undefined
  return relative === undefined ? undefined : new URL(relative, SKILL_DIR)
}

/** SKILL.md, a reference, or the list of topics for one it does not know. */
export async function guide(input: { topic?: string | undefined }): Promise<string> {
  const words = packageWords(input.topic)
  if (words !== undefined) return packagesText(words).text
  const target = guideFile(input.topic)
  if (target === undefined) throw new Error(`No guide topic "${input.topic}". Topics: ${Object.keys(GUIDE_TOPICS).join(", ")}, ${PACKAGES_TOPIC}; or no topic for SKILL.md.`)
  return withoutFrontmatter(await readFile(fileURLToPath(target), "utf8"))
}

/** The text less a leading `---` block (the skill's name and trigger description, which the agent has no use for). */
function withoutFrontmatter(text: string): string {
  const found = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n+/.exec(text)
  return found ? text.slice(found[0].length) : text
}

/**
 * guide for one MCP session: arguments that were answered already (equal once `again` is ignored; no topic and an empty
 * topic are the same) get a short line instead of the text, unless `again` is true.
 */
export async function guideInSession(memory: GuideMemory, input: { topic?: string | undefined; again?: boolean | undefined }): Promise<string> {
  const text = await guide(input)
  const key = (input.topic ?? "").trim().replace(/\s+/g, " ").toLowerCase()
  if (memory.has(key) && input.again !== true) {
    const what = key === "" ? "SKILL.md" : `The guide topic "${key}"`
    return `${what} was already returned in this session; use the text above. To get it again, call guide with the same arguments and again: true.`
  }
  memory.remember(key)
  return text
}

/** Every skill file, for the resources list: the URI, a name and the file. */
export function skillResources(): Array<{ name: string; uri: string; file: URL }> {
  return [
    { name: "SKILL", uri: "copperflow://skill/SKILL.md", file: new URL("SKILL.md", SKILL_DIR) },
    ...Object.entries(GUIDE_TOPICS).map(([name, relative]) => ({ name, uri: `copperflow://skill/${relative}`, file: new URL(relative, SKILL_DIR) })),
  ]
}
