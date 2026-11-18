// A drawing from an SVG or DXF file placed on the board (`<boardgraphic file layer x y width|scale rotation fill name />`):
// the limits a person or an agent is held to, shared by the build (which warns and leaves a bad one out) and the core's
// edits (which refuse it). The file is read through the build's project files, and only from graphics/. Pure.
import { pcbPoint, type Offset } from "./component.js"
import { diagnostic } from "./diagnostics.js"
import { MAX_COPPER_TRIANGLES, placeGraphic, triangulate } from "./graphic-place.js"
import { graphicKind, parseGraphic } from "./graphics/index.js"
import type { BoardGraphic, BoardGraphicLayer, Diagnostic, Net, Point, SourceRef } from "./model.js"
import { naturalCompare } from "./order.js"
import { PropReader, type Props } from "./read-props.js"

export const BOARD_GRAPHIC_TAG = "boardgraphic"
export const BOARD_GRAPHIC_LAYERS: readonly BoardGraphicLayer[] = ["top-silkscreen", "bottom-silkscreen", "top-mask", "bottom-mask", "top", "bottom", "inner1", "inner2"]
/** The copper layers a drawing can be on, named as pours name them; inner ones only on a 4-layer board. */
export const COPPER_GRAPHIC_LAYERS: readonly BoardGraphicLayer[] = ["top", "bottom", "inner1", "inner2"]
export const isCopperGraphic = (graphic: { layer: BoardGraphicLayer }): boolean => COPPER_GRAPHIC_LAYERS.includes(graphic.layer)
/** The longest net name a drawing may give, in characters. */
const MAX_NET_NAME = 200

/** What is wrong with a drawing's net as written, or undefined: a net name, and only on a copper layer. */
export function graphicNetProblem(net: unknown, layer: unknown): string | undefined {
  if (typeof net !== "string" || net.trim() === "" || net.length > MAX_NET_NAME) return 'net must be a net name such as "GND"'
  if (!(COPPER_GRAPHIC_LAYERS as readonly unknown[]).includes(layer)) return `net is only for a drawing on copper (${COPPER_GRAPHIC_LAYERS.join(", ")}); leave it out on ${String(layer)}`
  return undefined
}
/** The smallest and largest placed width or height, in mm. */
export const MIN_GRAPHIC_SIZE = 0.5
export const MAX_GRAPHIC_SIZE = 300
/** The largest scale taken: one mm of the drawing to this many on the board. */
export const MAX_GRAPHIC_SCALE = 1000
/** The only files a drawing is read from: an .svg or .dxf directly inside the project's graphics/ folder. */
export const GRAPHIC_FILE = /^graphics\/[A-Za-z0-9._ -]+\.(svg|dxf)$/i

/** A drawing's id: "boardgraphic:1", or inside a sub-sheet instance its path first. */
export const boardGraphicId = (index: number, instance: string | undefined): string =>
  instance === undefined ? `${BOARD_GRAPHIC_TAG}:${index}` : `${instance}/${BOARD_GRAPHIC_TAG}:${index}`

/** What is wrong with the file's path, or undefined. */
export function graphicFileProblem(file: unknown): string | undefined {
  if (typeof file !== "string" || !GRAPHIC_FILE.test(file) || file.split("/").some((part) => part.includes(".."))) {
    return 'file must be "graphics/<name>.svg" or "graphics/<name>.dxf", a drawing in the project\'s graphics folder'
  }
  return undefined
}

/** What is wrong with the layer, or undefined. */
export function graphicLayerProblem(layer: unknown): string | undefined {
  if ((BOARD_GRAPHIC_LAYERS as readonly unknown[]).includes(layer)) return undefined
  return `layer must be one of ${BOARD_GRAPHIC_LAYERS.join(", ")}`
}

/** What is wrong with a width in mm, or undefined. */
export function graphicWidthProblem(width: unknown): string | undefined {
  if (typeof width !== "number" || !Number.isFinite(width)) return "width must be a number of mm"
  if (width < MIN_GRAPHIC_SIZE || width > MAX_GRAPHIC_SIZE) return `width must be from ${MIN_GRAPHIC_SIZE} to ${MAX_GRAPHIC_SIZE} mm`
  return undefined
}

/** What is wrong with a scale, or undefined. */
export function graphicScaleProblem(scale: unknown): string | undefined {
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0 || scale > MAX_GRAPHIC_SCALE) return `scale must be a number above 0 and at most ${MAX_GRAPHIC_SCALE}`
  return undefined
}

interface Origin {
  offset: Offset
  index: number
  source: SourceRef
  instance?: string | undefined
}

type ReadFile = (path: string) => string | undefined

interface Wanted {
  file: string
  layer: BoardGraphicLayer
  x: number
  y: number
  rotation: number
  fill: boolean
  width?: number
  scale?: number
  name?: string
  /** The net as written; finishBoard turns it into the net's id, or refuses it. */
  net?: string
}

/** The props as written, or the reason they cannot be used. */
function readWanted(props: Props, reader: PropReader): Wanted | string {
  const [x, y] = [reader.length("x"), reader.length("y")]
  const layer = props["layer"] ?? "top-silkscreen"
  const width = props["width"] === undefined ? undefined : reader.length("width")
  const scale = props["scale"]
  const rotation = props["rotation"] === undefined ? 0 : reader.angle("rotation")
  const fill = props["fill"] ?? false
  if (x === undefined || y === undefined) return "needs x and y"
  const problem =
    graphicFileProblem(props["file"]) ??
    graphicLayerProblem(layer) ??
    (props["net"] === undefined ? undefined : graphicNetProblem(props["net"], layer)) ??
    (props["width"] !== undefined && scale !== undefined ? "give width or scale, not both" : undefined) ??
    (props["width"] === undefined ? undefined : graphicWidthProblem(width)) ??
    (scale === undefined ? undefined : graphicScaleProblem(scale)) ??
    (rotation === undefined ? "rotation must be a number of degrees" : undefined) ??
    (typeof fill === "boolean" ? undefined : "fill must be true or false")
  if (problem !== undefined) return problem
  const name = reader.string("name")
  return {
    file: props["file"] as string,
    layer: layer as BoardGraphicLayer,
    x,
    y,
    rotation: rotation as number,
    fill: fill as boolean,
    ...(width === undefined ? {} : { width }),
    ...(typeof scale === "number" ? { scale } : {}),
    ...(name === undefined ? {} : { name }),
    ...(typeof props["net"] === "string" ? { net: props["net"].trim() } : {}),
  }
}

/** " (left out: 2 text elements)", or nothing when the reader left nothing out. */
export const leftOut = (skipped: readonly string[]): string => (skipped.length === 0 ? "" : ` (left out: ${skipped.join("; ")})`)

type Geometry = Pick<BoardGraphic, "areas" | "lines" | "width" | "height" | "skipped" | "triangles">

/** Drawings in a project are few; the bound only guards against unbounded growth (keys hold the file's text). */
const MAX_CACHED = 32
const cache = new Map<string, Readonly<Geometry> | string>()

/** The drawing read and sized, turned and mirrored about (0, 0), or the reason it cannot be: what is the same however it is moved. */
function shaped(path: string, text: string, size: { width?: number; scale?: number }, rotation: number, fill: boolean, bottom: boolean, copper: boolean): Readonly<Geometry> | string {
  const shapes = parseGraphic(text, graphicKind(path) ?? "svg")
  if ("error" in shapes) return `${path} could not be read: ${shapes.error}`
  if (shapes.fills.length === 0 && shapes.strokes.length === 0) return `${path}: the drawing has nothing to draw${leftOut(shapes.skipped)}`
  const scale = size.scale ?? (size.width === undefined ? 1 : size.width / Math.max(shapes.width, Number.MIN_VALUE))
  const [width, height] = [shapes.width * scale, shapes.height * scale]
  if (Math.max(width, height) > MAX_GRAPHIC_SIZE) return `it would be ${width.toFixed(1)} × ${height.toFixed(1)} mm, larger than ${MAX_GRAPHIC_SIZE} mm; give a smaller width or scale`
  if (Math.max(width, height) < MIN_GRAPHIC_SIZE) return `it would be ${width.toFixed(2)} × ${height.toFixed(2)} mm, smaller than ${MIN_GRAPHIC_SIZE} mm; give a larger width or scale`
  const geometry = placeGraphic(shapes, { x: 0, y: 0, scale, rotation, bottom, fill })
  const triangles = copper ? triangulate(geometry.areas) : undefined
  if (triangles && triangles.length > MAX_COPPER_TRIANGLES) {
    return `on copper it is ${triangles.length} triangles, more than ${MAX_COPPER_TRIANGLES}; simplify the drawing (fewer points or shapes)`
  }
  return { ...geometry, ...(triangles ? { triangles } : {}), skipped: [...shapes.skipped, ...geometry.skipped] }
}

/** shaped, remembered by the file's text and everything but the position, so a rebuild reads and places a drawing once. */
function cachedShape(path: string, text: string, size: { width?: number; scale?: number }, rotation: number, fill: boolean, bottom: boolean, copper: boolean): Readonly<Geometry> | string {
  const key = `${path}\u0000${size.width ?? ""}|${size.scale ?? ""}|${rotation}|${fill}|${bottom}|${copper}\u0000${text}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const made = shaped(path, text, size, rotation, fill, bottom, copper)
  const frozen = typeof made === "string" ? made : deepFreeze(made)
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string)
  cache.set(key, frozen)
  return frozen
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const one of Object.values(value)) deepFreeze(one)
  }
  return value
}

/** The cached shape each placed drawing's areas were moved from, and where to: a drawing's work done once per shape. */
const placedShapes = new WeakMap<object, { shape: Readonly<Geometry>; at: Point }>()

/**
 * The shape the drawing's areas were placed from (shared by every build of the same file, size, turn and side) and the
 * point it was moved to; undefined for a drawing not built here.
 */
export function placedShape(graphic: Pick<BoardGraphic, "areas">): { shape: Readonly<Pick<BoardGraphic, "areas">>; at: Point } | undefined {
  return placedShapes.get(graphic.areas)
}

/** The drawing placed, or the reason it cannot be: the file missing or refused by the reader, or too small or large once sized. */
function placed(wanted: Wanted, origin: Origin, readFile: ReadFile | undefined): Omit<BoardGraphic, "id" | "source"> | string {
  const text = readFile?.(wanted.file)
  if (text === undefined) return `${wanted.file} was not found in the project; put the drawing there first`
  const at = pcbPoint(origin.offset, wanted.x, wanted.y)
  const rotation = wanted.rotation + (origin.offset.pcbRotation ?? 0)
  const size = { ...(wanted.width === undefined ? {} : { width: wanted.width }), ...(wanted.scale === undefined ? {} : { scale: wanted.scale }) }
  const shape = cachedShape(wanted.file, text, size, rotation, wanted.fill, wanted.layer.startsWith("bottom"), isCopperGraphic(wanted))
  if (typeof shape === "string") return shape
  const move = (p: Point): Point => ({ x: p.x + at.x, y: p.y + at.y })
  const { width: _w, scale: _s, ...rest } = wanted
  const areas = shape.areas.map((area) => ({ outer: area.outer.map(move), holes: area.holes.map((hole) => hole.map(move)) }))
  placedShapes.set(areas, { shape, at })
  return {
    ...rest,
    areas,
    lines: shape.lines.map((line) => ({ points: line.points.map(move), width: line.width })),
    ...(shape.triangles ? { triangles: shape.triangles.map((triangle) => triangle.map(move)) } : {}),
    width: shape.width,
    height: shape.height,
    skipped: [...shape.skipped],
    x: at.x,
    y: at.y,
    rotation,
  }
}

/**
 * One `<boardgraphic>`: the drawing in `file` centred on x, y (shifted and turned by the groups), on the top silkscreen
 * unless `layer` says, `width` mm wide keeping its aspect (or `scale` times its own size; its own size when neither),
 * turned `rotation` degrees, its closed lines filled when `fill`. A bad prop, a missing file or one the reader refuses
 * is warned about with the reason and left out.
 */
export function buildBoardGraphic(props: Props, origin: Origin, readFile: ReadFile | undefined): { graphic?: BoardGraphic; diagnostics: Diagnostic[] } {
  const id = boardGraphicId(origin.index, origin.instance)
  const reader = new PropReader(props, BOARD_GRAPHIC_TAG, origin.source)
  const wanted = readWanted(props, reader)
  const result = typeof wanted === "string" ? wanted : placed(wanted, origin, readFile)
  if (typeof result === "string") {
    const warning = diagnostic("bad-value", "warning", `${BOARD_GRAPHIC_TAG} ${id}: ${result}; it is ignored`, [id], origin.source)
    return { diagnostics: [...reader.diagnostics, warning] }
  }
  return { graphic: { id, ...result, source: origin.source }, diagnostics: reader.diagnostics }
}

/** The most net names a refusal lists. */
const NETS_LISTED = 20

/** "GND, SIG, VCC" (and "and N more"): the circuit's nets by their first name, as a refusal lists them. */
function netList(nets: readonly Net[]): string {
  const names = nets.flatMap((net) => net.names[0] ?? []).sort(naturalCompare)
  if (names.length === 0) return "it has none"
  const more = names.length > NETS_LISTED ? ` and ${names.length - NETS_LISTED} more` : ""
  return `its nets are ${names.slice(0, NETS_LISTED).join(", ")}${more}`
}

/** The id of the net a drawing names (by id or by any of its names), or undefined when the circuit has none such. */
export const graphicNetId = (nets: readonly Net[], written: string): string | undefined =>
  nets.find((net) => net.id === written)?.id ?? nets.find((net) => net.names.includes(written))?.id

/** "names the net NOPE, which the circuit does not have (its nets are GND, SIG)". */
export const missingNetText = (written: string, nets: readonly Net[]): string => `names the net ${written}, which the circuit does not have (${netList(nets)})`

/**
 * Each drawing's net as written turned into the net's id; a drawing naming a net the circuit lacks is a `drawing-net`
 * error listing the nets it has, and is left out.
 */
export function resolveGraphicNets(graphics: readonly BoardGraphic[], nets: readonly Net[]): { graphics: BoardGraphic[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const kept = graphics.flatMap((graphic): BoardGraphic[] => {
    if (graphic.net === undefined) return [graphic]
    const id = graphicNetId(nets, graphic.net)
    if (id !== undefined) return [{ ...graphic, net: id }]
    const message = `${graphic.id} ${missingNetText(graphic.net, nets)}; it is ignored`
    diagnostics.push(diagnostic("drawing-net", "error", message, [graphic.id], graphic.source))
    return []
  })
  return { graphics: kept, diagnostics }
}
