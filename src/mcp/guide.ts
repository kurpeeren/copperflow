// guide: the copperflow skill over MCP, for clients that do not install skills or read resources by themselves.
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { z } from "zod"

/** The skill's folder: skills/copperflow beside src/ and dist/. */
const SKILL_DIR = new URL("../../skills/copperflow/", import.meta.url)

/** The references by name. A topic is only ever looked up here, so it can never name another file. */
export const GUIDE_TOPICS: Readonly<Record<string, string>> = {
  "design-workflow": "references/design-workflow.md",
  copper: "references/copper.md",
  "writing-circuits": "references/writing-circuits.md",
  "parts-library": "references/parts-library.md",
  "design-rules": "references/design-rules.md",
  "editable-subset": "references/editable-subset.md",
}

export const guideInput = { topic: z.string().max(100).optional().describe(`One reference: ${Object.keys(GUIDE_TOPICS).join(", ")}; none gives SKILL.md`) }

export const GUIDE_DESCRIPTION = "The copperflow skill: how to design with these tools. Without a topic SKILL.md; with one, that reference. Call it first when the copperflow skill is not installed."

/** The skill file a topic names, as a URL inside the skill folder. */
export function guideFile(topic?: string): URL | undefined {
  if (topic === undefined || topic === "") return new URL("SKILL.md", SKILL_DIR)
  const relative = Object.hasOwn(GUIDE_TOPICS, topic) ? GUIDE_TOPICS[topic] : undefined
  return relative === undefined ? undefined : new URL(relative, SKILL_DIR)
}

/** SKILL.md, a reference, or the list of topics for one it does not know. */
export async function guide(input: { topic?: string | undefined }): Promise<string> {
  const target = guideFile(input.topic)
  if (target === undefined) throw new Error(`No guide topic "${input.topic}". Topics: ${Object.keys(GUIDE_TOPICS).join(", ")}; or no topic for SKILL.md.`)
  return readFile(fileURLToPath(target), "utf8")
}

/** Every skill file, for the resources list: the URI, a name and the file. */
export function skillResources(): Array<{ name: string; uri: string; file: URL }> {
  return [
    { name: "SKILL", uri: "copperflow://skill/SKILL.md", file: new URL("SKILL.md", SKILL_DIR) },
    ...Object.entries(GUIDE_TOPICS).map(([name, relative]) => ({ name, uri: `copperflow://skill/${relative}`, file: new URL(relative, SKILL_DIR) })),
  ]
}
