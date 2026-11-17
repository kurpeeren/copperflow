// The render of a change: the board after it, dimmed, with what was added, removed and moved marked (drawn by the
// Studio's change-draw.ts), and the words the picture's line ends with.
import type { DesignDiff } from "../engine/design-diff.js"
import type { Design } from "../engine/design.js"
import { changeView } from "./change-view.js"
import type { DesignSource } from "./design-source.js"
import type { RenderRequest } from "./render.js"
import { resolveCircuit } from "./workspace.js"

/** The words of the marks' look, in the order the legend shows them. */
const LOOK = "added is solid cyan, removed dashed orange, moved a dotted white outline with an arrow to the new place"

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** "change c0004 on the board after it: 1 part removed, 1 track added; added is solid cyan, ...". */
export function changeCaption(label: string, diff: DesignDiff, them = false): string {
  const counts: [number, string, string][] = [
    [diff.parts.removed.length, "part removed", "parts removed"],
    [diff.parts.added.length, "part added", "parts added"],
    [diff.parts.renamed.length, "part renamed", "parts renamed"],
    [diff.parts.moved.length, "part moved", "parts moved"],
    [diff.tracks.added.length, "track added", "tracks added"],
    [diff.tracks.removed.length, "track removed", "tracks removed"],
    [diff.vias.added.length, "via added", "vias added"],
    [diff.vias.removed.length, "via removed", "vias removed"],
    [diff.pours.added.length, "pour added", "pours added"],
    [diff.pours.removed.length, "pour removed", "pours removed"],
    [diff.board.holes.added.length, "hole added", "holes added"],
    [diff.board.holes.removed.length, "hole removed", "holes removed"],
  ]
  const said = counts.filter(([count]) => count > 0).map(([count, one, many]) => plural(count, one, many))
  const head = `${label} on the board after ${them ? "them" : "it"}`
  return said.length === 0 ? `${head}: nothing on the board changed` : `${head}: ${said.join(", ")}; ${LOOK}`
}

export interface ChangeChoice {
  change?: string | undefined
  since?: string | undefined
}

/**
 * The design after a change (or after everything since one) and the request that marks the change on it. Refuses both
 * at once, the schematic, and a change after which the circuit does not build. Undefined when neither is given.
 */
export async function changeRequest(
  root: string,
  file: string,
  request: RenderRequest,
  choice: ChangeChoice,
  engine?: DesignSource,
): Promise<{ request: RenderRequest; design: Design } | undefined> {
  if (choice.change !== undefined && choice.since !== undefined) throw new Error("Give change or since, not both")
  if (choice.change === undefined && choice.since === undefined) return undefined
  if (request.view !== "pcb") throw new Error("A change is drawn on the PCB only")
  const target = choice.change !== undefined ? { id: choice.change } : { since: choice.since as string }
  const label = "id" in target ? `change ${target.id}` : `changes after ${target.since}`
  const { file: circuit } = await resolveCircuit(root, file)
  const view = await changeView(root, target, { file: circuit, ...(engine ? { engine } : {}) })
  const one = view.circuits[0]
  if (!one) throw new Error(`No ${circuit} to draw`)
  if ("error" in one.after) throw new Error(`After the ${label} ${circuit} does not build: ${one.after.error}. There is nothing to draw.`)
  return { request: { ...request, change: { diff: one.diff, caption: changeCaption(label, one.diff, "since" in target) } }, design: one.after.design }
}
