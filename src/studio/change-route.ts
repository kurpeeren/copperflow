// GET /api/change: one change (?id=) or everything since one (?since=), for the PCB view to show over the board.
import { changeTarget, changeView } from "../core/change-view.js"
import type { ChangeLine } from "../core/change-words.js"
import type { Design } from "../engine/design.js"
import { onBoard, type DesignDiff } from "../engine/design-diff.js"
import type { DesignBuilder } from "./live.js"

/** What the Studio's change view draws and lists. */
export interface ChangeShown {
  title: string
  /** The lines under the title, as the agent reads them. */
  lines: ChangeLine[]
  /** The circuit drawn: the first one the changes wrote. */
  file?: string
  before?: Design
  after?: Design
  diff?: DesignDiff
  /** Something on the board changed; when not, the view says so and only lists the lines. */
  onBoard: boolean
}

export async function changeShown(root: string, query: URLSearchParams, builder: DesignBuilder): Promise<ChangeShown> {
  const target = changeTarget(query.get("id") ?? undefined, query.get("since") ?? undefined)
  if (!target) throw new Error("Give id or since")
  const file = query.get("file") ?? undefined
  const view = await changeView(root, target, { engine: builder, ...(file ? { file } : {}) })
  const lines = view.lines.slice(1)
  const one = view.circuits[0]
  if (!one) return { title: view.title, lines, onBoard: false }
  return {
    title: view.title,
    lines,
    file: one.file,
    ...("design" in one.before ? { before: one.before.design } : {}),
    ...("design" in one.after ? { after: one.after.design } : {}),
    diff: one.diff,
    onBoard: onBoard(one.diff),
  }
}
