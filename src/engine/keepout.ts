import { outlinePoints } from "./board.js"
import type { Offset } from "./component.js"
import { diagnostic } from "./diagnostics.js"
import type { Diagnostic, Keepout, Point, SourceRef } from "./model.js"
import { PropReader, type Props } from "./read-props.js"

const LAYERS = new Set<string>(["top", "bottom", "all"])

export interface BuiltKeepout {
  keepout?: Keepout
  diagnostics: Diagnostic[]
}

function centredRectangle(reader: PropReader, offset: Offset): Point[] | undefined {
  const width = reader.length("width")
  const height = reader.length("height")
  if (width === undefined || height === undefined) return undefined
  const cx = (reader.length("pcbX") ?? 0) + offset.pcbX
  const cy = (reader.length("pcbY") ?? 0) + offset.pcbY
  const [dx, dy] = [width / 2, height / 2]
  return [
    { x: cx - dx, y: cy - dy },
    { x: cx + dx, y: cy - dy },
    { x: cx + dx, y: cy + dy },
    { x: cx - dx, y: cy + dy },
  ]
}

/** Where the keepout lies: a given outline, shifted by the group offset, or a rectangle centred on pcbX/pcbY. */
function shapeOf(props: Props, reader: PropReader, offset: Offset, warn: (message: string) => void): Point[] | undefined {
  const given = props["outline"]
  if (given === undefined) {
    const rectangle = centredRectangle(reader, offset)
    if (!rectangle) warn("keepout needs width and height, or an outline")
    return rectangle
  }
  const points = outlinePoints(given)
  if (!points) warn("keepout: outline must be a list of at least 3 points with x and y")
  return points?.map((p) => ({ x: p.x + offset.pcbX, y: p.y + offset.pcbY }))
}

/** `index` is the keepout's 1-based place in source order. A keepout that cannot be placed gets a bad-value warning and no result. */
export function buildKeepout(props: Props, offset: Offset, index: number, source: SourceRef): BuiltKeepout {
  const reader = new PropReader(props, "keepout", source)
  const extra: Diagnostic[] = []
  const warn = (message: string) => extra.push(diagnostic("bad-value", "warning", message, ["keepout"], source))
  const outline = shapeOf(props, reader, offset, warn)
  const layers = props["layers"] ?? "all"
  const knownLayers = typeof layers === "string" && LAYERS.has(layers)
  if (!knownLayers) warn("keepout: layers must be top, bottom or all")
  const diagnostics = [...reader.diagnostics, ...extra]
  if (!outline || !knownLayers) return { diagnostics }
  return { keepout: { id: `keepout:${index}`, outline, layers: layers as Keepout["layers"], source }, diagnostics }
}
