import { pcbPoint, type Offset } from "./component.js"
import { diagnostic } from "./diagnostics.js"
import type { Diagnostic, Hole, SourceRef } from "./model.js"
import { PropReader, type Props } from "./read-props.js"

/** A pour's or hole's id: "hole:1", or inside a sub-sheet instance its path first, "PS1/hole:1". */
export const boardItemId = (tag: "copperpour" | "hole", index: number, instance: string | undefined): string =>
  instance === undefined ? `${tag}:${index}` : `${instance}/${tag}:${index}`

/**
 * A `<hole x y diameter />`: a non-plated hole at x, y (shifted by the group offset) of that diameter, all lengths.
 * `index` is its 1-based place among every `<hole>` tag of its file in source order, kept or not, so a dropped hole
 * does not renumber the ones after it; inside a sub-sheet instance the id starts with the instance path
 * ("PS1/hole:1"). One without a position or a positive diameter is warned about and left out.
 */
export function buildHole(props: Props, offset: Offset, index: number, source: SourceRef, instance?: string): { hole?: Hole; diagnostics: Diagnostic[] } {
  const id = boardItemId("hole", index, instance)
  const reader = new PropReader(props, "hole", source)
  const [x, y, diameter] = [reader.length("x"), reader.length("y"), reader.length("diameter")]
  const extra: Diagnostic[] = []
  const warn = (message: string) => extra.push(diagnostic("bad-value", "warning", message, [id], source))
  if (x === undefined || y === undefined || diameter === undefined) warn("hole needs x, y and diameter; it is ignored")
  else if (!(diameter > 0)) warn("hole: diameter must be more than 0; it is ignored")
  const diagnostics = [...reader.diagnostics, ...extra]
  if (x === undefined || y === undefined || diameter === undefined || !(diameter > 0)) return { diagnostics }
  const at = pcbPoint(offset, x, y)
  return { hole: { id, x: at.x, y: at.y, diameter, source }, diagnostics }
}
