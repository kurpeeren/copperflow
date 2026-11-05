import { diagnostic } from "./diagnostics.js"
import type { Board, Diagnostic, Point, SourceRef } from "./model.js"
import { PropReader, type Props } from "./read-props.js"
import { parseLength } from "./units.js"

export const DEFAULT_THICKNESS = 1.6
const MIN_OUTLINE_POINTS = 3

function outlinePoints(value: unknown): Point[] | undefined {
  if (!Array.isArray(value) || value.length < MIN_OUTLINE_POINTS) return undefined
  const points = value.map((item) => {
    const x = parseLength((item as { x?: unknown } | null)?.x)
    const y = parseLength((item as { y?: unknown } | null)?.y)
    return x === undefined || y === undefined ? undefined : { x, y }
  })
  return points.every((point): point is Point => point !== undefined) ? points : undefined
}

function rectangle(reader: PropReader): Point[] | undefined {
  const width = reader.length("width")
  const height = reader.length("height")
  if (width === undefined || height === undefined) return undefined
  const cx = reader.length("pcbX") ?? 0
  const cy = reader.length("pcbY") ?? 0
  const [dx, dy] = [width / 2, height / 2]
  return [
    { x: cx - dx, y: cy - dy },
    { x: cx + dx, y: cy - dy },
    { x: cx + dx, y: cy + dy },
    { x: cx - dx, y: cy + dy },
  ]
}

export function buildBoard(props: Props, source: SourceRef): { board: Board; diagnostics: Diagnostic[] } {
  const reader = new PropReader(props, "board", source)
  const diagnostics: Diagnostic[] = []
  const warn = (message: string, item: string) => diagnostics.push(diagnostic("bad-value", "warning", message, [item], source))
  const given = props["outline"]
  const fromOutline = given === undefined ? undefined : outlinePoints(given)
  if (given !== undefined && !fromOutline) warn("board: outline must be a list of at least 3 points with x and y", "board.outline")
  const outline = fromOutline ?? rectangle(reader) ?? []
  if (outline.length === 0) warn("board needs width and height, or an outline", "board")
  const layers = props["layers"]
  if (layers !== undefined && layers !== 2 && layers !== 4) warn("board: layers must be 2 or 4", "board.layers")
  const maxTrace = reader.length("schMaxTraceDistance")
  const board: Board = {
    outline,
    layers: layers === 4 ? 4 : 2,
    thickness: reader.length("thickness") ?? DEFAULT_THICKNESS,
    ...(maxTrace !== undefined ? { schMaxTraceDistance: maxTrace } : {}),
  }
  return { board, diagnostics: [...reader.diagnostics, ...diagnostics] }
}
