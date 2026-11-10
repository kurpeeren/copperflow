import { resolve } from "node:path"
import { isMap, parseDocument } from "yaml"
import { RULES_PATH } from "../engine/rules/load.js"
import { DEFAULT_FILLET_RADIUS, MAX_FILLET_RADIUS } from "../engine/rules/track-defaults.js"
import { EditError } from "./edit-error.js"
import { inProjectQueue, readIfThere, writeNew, writeWithHistory } from "./file-writes.js"
import type { Author, HistoryEntry } from "./history.js"

/**
 * Design-rule changes the Studio makes to rules.yaml (the Design rules panel): the fillet radius, under `fabrication`.
 * The rest of the file stays as written, comments included; each change is one history entry.
 */

const FIELD = ["fabrication", "filletRadius"] as const
/** Flow lists stay as people write them, `[GND, VBUS]`, not `[ GND, VBUS ]`. */
const WRITE = { flowCollectionPadding: false } as const

function checkRadius(radius: number | undefined): void {
  if (radius === undefined) return
  if (!Number.isFinite(radius) || radius <= 0 || radius > MAX_FILLET_RADIUS) {
    throw new EditError("invalid", `The fillet radius must be a length above 0 and at most ${MAX_FILLET_RADIUS} mm`)
  }
}

/** rules.yaml's text with the fillet radius set, or taken out (back to the default) when `radius` is undefined. */
export function withFilletRadius(text: string, radius: number | undefined): string {
  checkRadius(radius)
  const document = parseDocument(text)
  const problem = document.errors[0]
  if (problem) throw new EditError("invalid", `${RULES_PATH} cannot be read (${problem.message.split("\n")[0]}); fix it first`)
  if (radius !== undefined) {
    document.setIn([...FIELD], radius)
    return document.toString(WRITE)
  }
  if (!document.hasIn([...FIELD])) return text
  document.deleteIn([...FIELD])
  const fabrication = document.getIn([FIELD[0]], true)
  if (isMap(fabrication) && fabrication.items.length === 0) document.deleteIn([FIELD[0]])
  const contents = document.contents
  return isMap(contents) && contents.items.length === 0 ? "" : document.toString(WRITE)
}

/** Sets the fillet radius in the project's rules.yaml (creating it when there is none) as one history entry. */
export function setFilletRadius(root: string, radius: number | undefined, meta: { author: Author }): Promise<HistoryEntry> {
  checkRadius(radius)
  return inProjectQueue(root, async () => {
    const path = resolve(root, RULES_PATH)
    const source = await readIfThere(path)
    const text = withFilletRadius(source ?? "", radius)
    if (text === (source ?? "")) throw new EditError("invalid", "The edit made no change")
    const summary = radius === undefined ? `Set the fillet radius back to the default, ${DEFAULT_FILLET_RADIUS} mm` : `Set the fillet radius to ${radius} mm`
    if (source === undefined) return writeNew(root, path, text, { author: meta.author, summary })
    return writeWithHistory(root, { path, source, file: RULES_PATH }, text, { author: meta.author, summary, file: RULES_PATH, before: source, after: text })
  })
}
