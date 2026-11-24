import { diagnostic } from "./diagnostics.js"
import type { Board, Diagnostic, Point, SourceRef } from "./model.js"
import { PropReader, type Props } from "./read-props.js"
import { gridAround, gridOutline, MAX_HOLES, MIN_HOLES, PROTO_KINDS, type ProtoGrid, type ProtoKind } from "./proto/grid.js"
import { parseLength } from "./units.js"

export const DEFAULT_THICKNESS = 1.6

/** An outline needs this many corners to enclose anything: the board reader, placement and the checks all use it. */
export const MIN_OUTLINE_POINTS = 3

/** True when there is a board whose outline has at least 3 corners, so placement and checks can measure against it. */
export function usableOutline(board: Board | undefined): boolean {
  return board !== undefined && board.outline.length >= MIN_OUTLINE_POINTS
}

export function outlinePoints(value: unknown): Point[] | undefined {
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

const holeCount = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= MIN_HOLES && value <= MAX_HOLES ? value : undefined

/**
 * The hole grid of a board whose kind is perfboard or stripboard, centred on pcbX, pcbY; undefined for a made PCB.
 * A bad kind, hole count or strip direction is a warning; width, height and outline beside a grid are ignored.
 */
function protoGrid(props: Props, reader: PropReader, warn: (message: string, item: string) => void): ProtoGrid | undefined {
  const kind = props["kind"]
  if (kind === undefined || kind === "pcb") return undefined
  if (!PROTO_KINDS.includes(kind as ProtoKind)) {
    warn(`board: kind must be "pcb", "perfboard" or "stripboard"`, "board.kind")
    return undefined
  }
  const [columns, rows] = [holeCount(props["columns"]), holeCount(props["rows"])]
  if (columns === undefined || rows === undefined) {
    warn(`board: a ${String(kind)} needs columns and rows, whole numbers of holes from ${MIN_HOLES} to ${MAX_HOLES}`, "board.columns")
    return undefined
  }
  const strips = props["strips"]
  if (strips !== undefined && (kind !== "stripboard" || (strips !== "rows" && strips !== "columns"))) {
    warn(kind === "stripboard" ? 'board: strips must be "rows" or "columns"' : "board: strips is for a stripboard", "board.strips")
  }
  const ignored = ["width", "height", "outline"].filter((key) => props[key] !== undefined)
  if (ignored.length > 0) warn(`board: a ${String(kind)} takes its size from columns and rows; ${ignored.join(", ")} ignored`, `board.${ignored[0]}`)
  const centre = { x: reader.length("pcbX") ?? 0, y: reader.length("pcbY") ?? 0 }
  return gridAround(kind as ProtoKind, columns, rows, centre, strips === "columns" ? "columns" : "rows")
}

export function buildBoard(props: Props, source: SourceRef): { board: Board; diagnostics: Diagnostic[] } {
  const reader = new PropReader(props, "board", source)
  const diagnostics: Diagnostic[] = []
  const warn = (message: string, item: string) => diagnostics.push(diagnostic("bad-value", "warning", message, [item], source))
  const proto = protoGrid(props, reader, warn)
  if (proto) return { board: { outline: gridOutline(proto), layers: 2, thickness: reader.length("thickness") ?? DEFAULT_THICKNESS, keepouts: [], proto }, diagnostics: [...reader.diagnostics, ...diagnostics] }
  const given = props["outline"]
  const fromOutline = given === undefined ? undefined : outlinePoints(given)
  if (given !== undefined && !fromOutline) warn("board: outline must be a list of at least 3 points with x and y", "board.outline")
  const outline = fromOutline ?? rectangle(reader) ?? []
  if (outline.length === 0) warn("board needs width and height, or an outline", "board")
  const layers = props["layers"]
  if (layers !== undefined && layers !== 2 && layers !== 4) warn("board: layers must be 2 or 4", "board.layers")
  const maxTrace = reader.length("schMaxTraceDistance")
  const thickness = reader.length("thickness")
  const board: Board = {
    outline,
    layers: layers === 4 ? 4 : 2,
    thickness: thickness ?? DEFAULT_THICKNESS,
    ...(thickness !== undefined ? { thicknessGiven: true as const } : {}),
    keepouts: [],
    ...(maxTrace !== undefined ? { schMaxTraceDistance: maxTrace } : {}),
  }
  return { board, diagnostics: [...reader.diagnostics, ...diagnostics] }
}
