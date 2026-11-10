import { outlinePoints } from "../board.js"
import { pcbPoint, type Offset } from "../component.js"
import { diagnostic } from "../diagnostics.js"
import type { Board, CopperPour, Diagnostic, Net, Point, PourLayer, SourceRef } from "../model.js"
import { boardItemId } from "../hole.js"
import { PropReader, type Props } from "../read-props.js"
import { difference, pathArea, toPath } from "./clip.js"

export const POUR_DEFAULTS = { priority: 0, minWidth: 0.25, thermal: "relief", thermalWidth: 0.3, thermalGap: 0.25 } as const

const LAYERS: readonly PourLayer[] = ["top", "bottom", "inner1", "inner2"]
const INNER: readonly PourLayer[] = ["inner1", "inner2"]
/** An outline counts as leaving the board when more than this much of it (in square micrometres) is off it. */
const OUTSIDE_AREA = 1

/** A pour as read from its tag, its net still as written. */
export type PourDraft = Omit<CopperPour, "net"> & { netName: string }

type Warn = (message: string) => void

/** A positive length, or the default with a warning when the prop is there but not positive. */
function positive(reader: PropReader, key: "clearance" | "minWidth" | "thermalWidth" | "thermalGap", warn: Warn): number | undefined {
  const value = reader.length(key)
  if (value === undefined || value > 0) return value
  warn(`copperpour: ${key} must be more than 0; ${key === "clearance" ? "the net class's clearance" : POUR_DEFAULTS[key]} is used`)
  return undefined
}

function priorityOf(value: unknown, warn: Warn): number {
  if (value === undefined) return POUR_DEFAULTS.priority
  if (typeof value === "number" && Number.isFinite(value)) return value
  warn(`copperpour: priority must be a number; ${POUR_DEFAULTS.priority} is used`)
  return POUR_DEFAULTS.priority
}

function thermalOf(value: unknown, warn: Warn): CopperPour["thermal"] {
  if (value === undefined || value === "relief" || value === "solid") return value ?? POUR_DEFAULTS.thermal
  warn(`copperpour: thermal must be "relief" or "solid"; ${POUR_DEFAULTS.thermal} is used`)
  return POUR_DEFAULTS.thermal
}

/** The drawn outline shifted by the group offset; undefined for none, null for one that is not a polygon. */
function outlineOf(value: unknown, offset: Offset, warn: Warn): Point[] | undefined | null {
  if (value === undefined) return undefined
  const points = outlinePoints(value)
  if (!points) warn("copperpour: outline must be a list of at least 3 points with x and y; the pour is ignored")
  return points ? points.map((p) => pcbPoint(offset, p.x, p.y)) : null
}

/**
 * A `<copperpour net layer … />` as written: a pour needs a net and a layer, and an outline when it has one must be a
 * polygon; a bad optional prop is warned about and its default used. `index` is its 1-based place among every
 * `<copperpour>` tag of its file in source order, kept or not, so a dropped pour does not renumber the ones after it;
 * inside a sub-sheet instance the id starts with the instance path ("PS1/copperpour:1").
 */
export function buildPour(props: Props, offset: Offset, index: number, source: SourceRef, instance?: string): { pour?: PourDraft; diagnostics: Diagnostic[] } {
  const id = boardItemId("copperpour", index, instance)
  const reader = new PropReader(props, "copperpour", source)
  const extra: Diagnostic[] = []
  const warn: Warn = (message) => extra.push(diagnostic("bad-value", "warning", message, [id], source))
  const netName = reader.string("net")
  if (netName === undefined) warn('copperpour needs a net, such as net="GND"; it is ignored')
  const layer = props["layer"]
  const knownLayer = LAYERS.includes(layer as PourLayer)
  if (!knownLayer) warn("copperpour: layer must be top, bottom, inner1 or inner2; the pour is ignored")
  const outline = outlineOf(props["outline"], offset, warn)
  const clearance = positive(reader, "clearance", warn)
  const pour = {
    id,
    netName: netName ?? "",
    layer: layer as PourLayer,
    ...(outline ? { outline } : {}),
    priority: priorityOf(props["priority"], warn),
    ...(clearance === undefined ? {} : { clearance }),
    minWidth: positive(reader, "minWidth", warn) ?? POUR_DEFAULTS.minWidth,
    thermal: thermalOf(props["thermal"], warn),
    thermalWidth: positive(reader, "thermalWidth", warn) ?? POUR_DEFAULTS.thermalWidth,
    thermalGap: positive(reader, "thermalGap", warn) ?? POUR_DEFAULTS.thermalGap,
    source,
  }
  const diagnostics = [...reader.diagnostics, ...extra]
  return netName === undefined || !knownLayer || outline === null ? { diagnostics } : { pour, diagnostics }
}

/** The net id a pour names, by name or by id. */
function netIdOf(nets: readonly Net[], name: string): string | undefined {
  return nets.find((net) => net.id === name)?.id ?? nets.find((net) => net.names.includes(name))?.id
}

const outsideBoard = (outline: readonly Point[], board: Board) =>
  difference([toPath(outline)], [toPath(board.outline)]).reduce((sum, path) => sum + Math.abs(pathArea(path)), 0) > OUTSIDE_AREA

/**
 * The pours checked against the circuit and the board: the net must exist (else a `pour-net` error) and the layer be
 * one the board has (else a warning), or the pour is left out; an outline that leaves the board is warned about and filled only on the board.
 */
export function resolvePours(drafts: readonly PourDraft[], nets: readonly Net[], board: Board): { pours: CopperPour[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const pours = drafts.flatMap(({ netName, ...draft }): CopperPour[] => {
    const warn: Warn = (message) => diagnostics.push(diagnostic("bad-value", "warning", message, [draft.id], draft.source))
    const net = netIdOf(nets, netName)
    if (net === undefined) {
      diagnostics.push(diagnostic("pour-net", "error", `${draft.id} names the net ${netName}, which the circuit does not have`, [draft.id], draft.source))
      return []
    }
    if (board.layers === 2 && INNER.includes(draft.layer)) {
      warn(`copperpour: a 2-layer board has no ${draft.layer}; the pour is ignored`)
      return []
    }
    if (draft.outline && board.outline.length >= 3 && outsideBoard(draft.outline, board)) {
      warn("copperpour: the outline goes outside the board; only the part on the board is filled")
    }
    return [{ ...draft, net }]
  })
  return { pours, diagnostics }
}
