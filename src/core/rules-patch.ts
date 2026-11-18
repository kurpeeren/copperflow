// The agent's set_rules: a partial rules object merged into rules.yaml, checked exactly as a build reads the file, and
// written as one history entry. Objects merge key by key, any other value replaces what is there, null removes a key.
// The rest of the file stays as written, comments included.
import { resolve } from "node:path"
import { isMap, parseDocument, type Document } from "yaml"
import { loadRules, RULES_PATH } from "../engine/rules/load.js"
import { EditError } from "./edit-error.js"
import { inProjectQueue, readIfThere, writeNew, writeWithHistory } from "./file-writes.js"
import type { Author, HistoryEntry } from "./history.js"

export type RulesPatch = Readonly<Record<string, unknown>>

/** Flow lists stay as people write them, `[GND, VBUS]`, not `[ GND, VBUS ]`. */
const WRITE = { flowCollectionPadding: false } as const
const RESERVED = new Set(["__proto__", "constructor", "prototype"])

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** Removes the maps a removal left empty, from the deepest up. */
function pruneEmpty(document: Document, path: readonly string[]): void {
  for (let length = path.length - 1; length >= 1; length -= 1) {
    const node = document.getIn(path.slice(0, length), true)
    if (!isMap(node) || node.items.length > 0) return
    document.deleteIn(path.slice(0, length))
  }
}

/** Applies the patch under `path` to the document; answers each change as "a.b = value" or "a.b removed". */
function applyPatch(document: Document, path: readonly string[], patch: RulesPatch): string[] {
  return Object.entries(patch).flatMap(([key, value]) => {
    if (RESERVED.has(key)) throw new EditError("invalid", `"${key}" cannot be a key in ${RULES_PATH}`)
    const at = [...path, key]
    const name = at.join(".")
    if (value === null) {
      if (!document.hasIn(at)) return []
      document.deleteIn(at)
      pruneEmpty(document, at)
      return [`${name} removed`]
    }
    if (isPlainObject(value) && isMap(document.getIn(at, true))) return applyPatch(document, at, value)
    document.setIn(at, value)
    return [`${name} = ${echoed(value)}`]
  })
}

/** The most characters of a value an answer repeats. */
const ECHO_LIMIT = 200

const echoed = (value: unknown): string => {
  const text = JSON.stringify(value)
  return text.length > ECHO_LIMIT ? `${text.slice(0, ECHO_LIMIT)}…` : text
}

/** Throws on a reserved key anywhere in the value, before anything is merged. */
function checkKeys(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(checkKeys)
  if (!isPlainObject(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (RESERVED.has(key)) throw new EditError("invalid", `"${key}" cannot be a key in ${RULES_PATH}`)
    checkKeys(child)
  }
}

/** A build's problems with the text, as the schema words them, without the file and line of a text no one sees. */
function problemsOf(text: string): string[] {
  const { diagnostics } = loadRules({ [RULES_PATH]: text })
  return diagnostics.filter((d) => d.severity === "error").map((d) => d.message.replace(/^rules\.yaml(:\d+)?: /, ""))
}

/**
 * rules.yaml's text with the patch merged in, and the changes it made; refused (nothing changes) when the file cannot
 * be read, when the result is a file a build would refuse, or when it changes nothing.
 */
export function patchRulesText(text: string, patch: RulesPatch): { text: string; changes: string[] } {
  if (!isPlainObject(patch) || Object.keys(patch).length === 0) throw new EditError("invalid", 'rules must be an object of rules.yaml keys, e.g. { "fabrication": { "profile": "jlcpcb-4layer" } }')
  const document = parseDocument(text)
  const problem = document.errors[0]
  if (problem) throw new EditError("invalid", `${RULES_PATH} cannot be read (${problem.message.split("\n")[0]}); fix it first`)
  checkKeys(patch)
  if (document.contents !== null && !isMap(document.contents)) throw new EditError("invalid", `${RULES_PATH} is not a map of settings (key: value); it was not changed`)
  const changes = applyPatch(document, [], patch)
  const contents = document.contents
  const next = isMap(contents) && contents.items.length === 0 ? "" : document.toString(WRITE)
  if (changes.length === 0 || next === text) throw new EditError("invalid", `${RULES_PATH} already says that; nothing was written`)
  const problems = problemsOf(next)
  if (problems.length > 0) throw new EditError("invalid", `${RULES_PATH} was not changed: ${problems.join("; ")}`)
  return { text: next, changes }
}

/** Merges the patch into the project's rules.yaml (creating it when there is none) as one history entry. */
export function setRules(root: string, patch: RulesPatch, meta: { author: Author }): Promise<{ entry: HistoryEntry; changes: string[] }> {
  return inProjectQueue(root, async () => {
    const path = resolve(root, RULES_PATH)
    const source = await readIfThere(path)
    const { text, changes } = patchRulesText(source ?? "", patch)
    const summary = `Set rules: ${changes.join(", ")}`.slice(0, 200)
    const entry =
      source === undefined
        ? await writeNew(root, path, text, { author: meta.author, summary })
        : await writeWithHistory(root, { path, source, file: RULES_PATH }, text, { author: meta.author, summary, file: RULES_PATH, before: source, after: text })
    return { entry, changes }
  })
}
