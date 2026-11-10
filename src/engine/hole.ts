import { pcbPoint, type Offset } from "./component.js"
import { diagnostic } from "./diagnostics.js"
import type { Diagnostic, Hole, SourceRef } from "./model.js"
import { PropReader, type Props } from "./read-props.js"

/**
 * A `<hole x y diameter />`: a non-plated hole at x, y (shifted by the group offset) of that diameter, all lengths.
 * `index` is its 1-based place among every `<hole>` tag in
 * source order, kept or not, so a dropped hole does not renumber the ones after it. One without a position or a positive diameter is warned about
 * and left out.
 */
export function buildHole(props: Props, offset: Offset, index: number, source: SourceRef): { hole?: Hole; diagnostics: Diagnostic[] } {
  const reader = new PropReader(props, "hole", source)
  const [x, y, diameter] = [reader.length("x"), reader.length("y"), reader.length("diameter")]
  const extra: Diagnostic[] = []
  const warn = (message: string) => extra.push(diagnostic("bad-value", "warning", message, [`hole:${index}`], source))
  if (x === undefined || y === undefined || diameter === undefined) warn("hole needs x, y and diameter; it is ignored")
  else if (!(diameter > 0)) warn("hole: diameter must be more than 0; it is ignored")
  const diagnostics = [...reader.diagnostics, ...extra]
  if (x === undefined || y === undefined || diameter === undefined || !(diameter > 0)) return { diagnostics }
  const at = pcbPoint(offset, x, y)
  return { hole: { id: `hole:${index}`, x: at.x, y: at.y, diameter, source }, diagnostics }
}
