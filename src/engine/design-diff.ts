// What changed between two built designs, as data: parts, nets, copper, the board, the rules and the checks. Pure, and
// in the same order every time, so the words for the agent and the marks on the board come out the same.
import type { Design } from "./design.js"
import type { Hole, Point, Severity } from "./model.js"
import { naturalCompare } from "./order.js"
import type { PlacedFootprint } from "./pcb.js"

/** A built design, or why the circuit code did not build. */
export type BuiltSide = { design: Design } | { error: string }

export interface PartAt {
  name: string
  x: number
  y: number
  rotation: number
  side: "top" | "bottom"
  courtyard: Point[]
  value?: string
  footprint?: string
}
export interface PartMove {
  name: string
  from: PartAt
  to: PartAt
}
export interface PartEdit {
  name: string
  field: "value" | "footprint" | "mpn"
  from?: string
  to?: string
}
export interface PinNet {
  pin: string
  net: string
}
export interface TrackAt {
  id: string
  net?: string
  layer: string
  width: number
  points: Point[]
  /** In mm, to 0.01 mm. */
  length: number
}
export interface ViaAt {
  id: string
  net?: string
  at: Point
  diameter: number
}
export interface PourAt {
  id: string
  net: string
  layer: string
  outline?: Point[]
}
export interface CheckAt {
  id: string
  /** The rule or diagnostic code; findings of one code and severity are told as one group. */
  code?: string
  severity: Severity
  message: string
  at?: Point
}
export interface Added<T> {
  added: T[]
  removed: T[]
}

export interface DesignDiff {
  /** The side whose circuit code did not build, and why; then nothing else is compared. */
  failed?: { side: "before" | "after" | "both"; message: string }
  parts: Added<PartAt> & { moved: PartMove[]; changed: PartEdit[]; renamed: { from: string; to: string; at: PartAt }[] }
  nets: { appeared: string[]; went: string[]; joined: PinNet[]; left: PinNet[] }
  tracks: Added<TrackAt>
  vias: Added<ViaAt>
  pours: Added<PourAt>
  board: { size?: { from: string; to: string }; outline: boolean; layers?: { from: number; to: number }; holes: Added<Hole> }
  rules: { path: string; from: string; to: string }[]
  checks: { appeared: CheckAt[]; went: CheckAt[] }
  /** Parts whose schematic symbol moved or turned. */
  schematic: { moved: string[] }
}

const EMPTY: DesignDiff = {
  parts: { added: [], removed: [], moved: [], changed: [], renamed: [] },
  nets: { appeared: [], went: [], joined: [], left: [] },
  tracks: { added: [], removed: [] },
  vias: { added: [], removed: [] },
  pours: { added: [], removed: [] },
  board: { outline: false, holes: { added: [], removed: [] } },
  rules: [],
  checks: { appeared: [], went: [] },
  schematic: { moved: [] },
}
/** Positions closer than this (mm, degrees) are the same. */
const SAME = 1e-6
const MAX_RULES = 50
const MAX_RULE_TEXT = 40

const byName = <T extends { name: string }>(a: T, b: T) => naturalCompare(a.name, b.name)
const byId = <T extends { id: string }>(a: T, b: T) => naturalCompare(a.id, b.id)
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits
const near = (a: number, b: number) => Math.abs(a - b) < SAME

/** Items whose key is only on one side, each side in the given order. */
function added<T>(before: readonly T[], after: readonly T[], key: (item: T) => string, order: (a: T, b: T) => number): Added<T> {
  const was = new Set(before.map(key))
  const is = new Set(after.map(key))
  return { added: after.filter((item) => !was.has(key(item))).sort(order), removed: before.filter((item) => !is.has(key(item))).sort(order) }
}

const componentOf = (design: Design, name: string) => design.circuit.components.find((one) => one.id === name)

function partAt(design: Design, part: PlacedFootprint): PartAt {
  const component = componentOf(design, part.component)
  return {
    name: part.component,
    x: part.x,
    y: part.y,
    rotation: part.rotation,
    side: part.side,
    courtyard: part.courtyard,
    ...(component?.value !== undefined ? { value: component.value } : {}),
    ...(component?.footprint !== undefined ? { footprint: component.footprint } : {}),
  }
}

const samePlace = (a: PartAt, b: PartAt) => near(a.x, b.x) && near(a.y, b.y) && near(a.rotation, b.rotation) && a.side === b.side
const sameKind = (a: PartAt, b: PartAt) => samePlace(a, b) && a.footprint === b.footprint && a.value === b.value

/** A removed part and an added one with the same footprint, value and place, when exactly one of each fits: a rename. */
function renames(removed: readonly PartAt[], made: readonly PartAt[]): Map<string, PartAt> {
  const found = new Map<string, PartAt>()
  for (const gone of removed) {
    const fits = made.filter((part) => sameKind(gone, part))
    const only = fits[0]
    if (fits.length === 1 && only && removed.filter((other) => sameKind(other, only)).length === 1) found.set(gone.name, only)
  }
  return found
}

function edits(before: Design, after: Design, name: string): PartEdit[] {
  const old = componentOf(before, name)
  const now = componentOf(after, name)
  return (["value", "footprint", "mpn"] as const).flatMap((field) => {
    const a = old?.[field]
    const b = now?.[field]
    return a === b ? [] : [{ name, field, ...(a !== undefined ? { from: a } : {}), ...(b !== undefined ? { to: b } : {}) }]
  })
}

function partsDiff(before: Design, after: Design): DesignDiff["parts"] {
  const was = before.pcb.parts.map((part) => partAt(before, part))
  const is = after.pcb.parts.map((part) => partAt(after, part)).sort(byName)
  const plain = added(was, is, (part) => part.name, byName)
  const renamed = renames(plain.removed, plain.added)
  const madeByRename = new Set([...renamed.values()].map((part) => part.name))
  const wasByName = new Map(was.map((part) => [part.name, part]))
  const moved: PartMove[] = []
  const changed: PartEdit[] = []
  for (const to of is) {
    const from = wasByName.get(to.name)
    if (!from) continue
    if (!samePlace(from, to)) moved.push({ name: to.name, from, to })
    changed.push(...edits(before, after, to.name))
  }
  return {
    added: plain.added.filter((part) => !madeByRename.has(part.name)),
    removed: plain.removed.filter((part) => !renamed.has(part.name)),
    moved,
    changed,
    renamed: [...renamed].map(([from, at]) => ({ from, to: at.name, at })).sort((a, b) => naturalCompare(a.from, b.from)),
  }
}

type Net = Design["circuit"]["nets"][number]
const netName = (net: Net) => net.names[0] ?? net.id

const renamedPin = (pin: string, renamed: ReadonlyMap<string, string>) => {
  const dot = pin.indexOf(".")
  const part = pin.slice(0, dot)
  return `${renamed.get(part) ?? part}${pin.slice(dot)}`
}

/** Each pin's net by the name given: the pins of renamed parts under their new names. */
function pinNets(nets: readonly Net[], name: (net: Net) => string, renamed: ReadonlyMap<string, string>): Map<string, string> {
  const pins = new Map<string, string>()
  for (const net of nets) for (const pin of net.pins) pins.set(renamedPin(pin, renamed), name(net))
  return pins
}

/**
 * The name of each net after, as the before side knew it: an unnamed net is named by its first pin, which changes when a
 * pin joins in front of it, so it keeps the id of the unnamed net before that shared the most pins with it.
 */
function namesAfter(before: readonly Net[], after: readonly Net[], renamed: ReadonlyMap<string, string>): (net: Net) => string {
  const unnamed = before.filter((net) => net.names.length === 0).map((net) => ({ id: net.id, pins: new Set(net.pins.map((pin) => renamedPin(pin, renamed))) }))
  const names = new Map<string, string>()
  for (const net of after) {
    if (net.names.length > 0) continue
    const shared = (pins: ReadonlySet<string>) => net.pins.filter((pin) => pins.has(pin)).length
    const best = unnamed.reduce<{ id: string; count: number } | undefined>((top, old) => {
      const count = shared(old.pins)
      return count > (top?.count ?? 0) ? { id: old.id, count } : top
    }, undefined)
    if (best) names.set(net.id, best.id)
  }
  return (net) => names.get(net.id) ?? netName(net)
}

function netsDiff(before: Design, after: Design, parts: DesignDiff["parts"]): DesignDiff["nets"] {
  const renamed = new Map(parts.renamed.map((r) => [r.from, r.to]))
  const nameAfter = namesAfter(before.circuit.nets, after.circuit.nets, renamed)
  const was = new Set(before.circuit.nets.map(netName))
  const is = new Set(after.circuit.nets.map(nameAfter))
  const old = pinNets(before.circuit.nets, netName, renamed)
  const now = pinNets(after.circuit.nets, nameAfter, new Map())
  const joined: PinNet[] = []
  const left: PinNet[] = []
  for (const pin of [...new Set([...old.keys(), ...now.keys()])].sort(naturalCompare)) {
    const a = old.get(pin)
    const b = now.get(pin)
    if (a === b) continue
    if (a !== undefined) left.push({ pin, net: a })
    if (b !== undefined) joined.push({ pin, net: b })
  }
  return {
    appeared: [...is].filter((net) => !was.has(net)).sort(naturalCompare),
    went: [...was].filter((net) => !is.has(net)).sort(naturalCompare),
    joined,
    left,
  }
}

const lengthOf = (points: readonly Point[]) =>
  round(points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - (points[i] as Point).x, p.y - (points[i] as Point).y), 0))

function copperDiff(before: Design, after: Design): Pick<DesignDiff, "tracks" | "vias" | "pours"> {
  const track = (one: Design["pcb"]["tracks"][number]): TrackAt => ({
    id: one.id,
    ...(one.net !== undefined ? { net: one.net } : {}),
    layer: one.layer,
    width: one.width,
    points: one.points,
    length: lengthOf(one.points),
  })
  const via = (one: Design["pcb"]["vias"][number]): ViaAt => ({ id: one.id, ...(one.net !== undefined ? { net: one.net } : {}), at: one.at, diameter: one.diameter })
  const pours = (design: Design): PourAt[] =>
    (design.pcb.board?.pours ?? []).map((pour) => ({ id: pour.id, net: pour.net, layer: pour.layer, ...(pour.outline ? { outline: pour.outline } : {}) }))
  // A track or via whose copper changed under the same id is the old one removed and the new one added. The net it
  // carries is left out: moving a part can change which net still-standing copper resolves to.
  const shape = ({ net: _net, ...copper }: TrackAt | ViaAt) => JSON.stringify(copper)
  const pourShape = (item: PourAt) => JSON.stringify(item)
  return {
    tracks: added(before.pcb.tracks.map(track), after.pcb.tracks.map(track), shape, byId),
    vias: added(before.pcb.vias.map(via), after.pcb.vias.map(via), shape, byId),
    pours: added(pours(before), pours(after), pourShape, byId),
  }
}

function sizeOf(outline: readonly Point[] | undefined): string {
  if (!outline || outline.length === 0) return "none"
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  return `${round(Math.max(...xs) - Math.min(...xs), 1)} x ${round(Math.max(...ys) - Math.min(...ys), 1)} mm`
}

function boardDiff(before: Design, after: Design): DesignDiff["board"] {
  const a = before.pcb.board
  const b = after.pcb.board
  const from = sizeOf(a?.outline)
  const to = sizeOf(b?.outline)
  const hole = (item: Hole) => `${item.id} ${item.x} ${item.y} ${item.diameter}`
  return {
    ...(from !== to ? { size: { from, to } } : {}),
    outline: JSON.stringify(a?.outline ?? []) !== JSON.stringify(b?.outline ?? []),
    ...(a && b && a.layers !== b.layers ? { layers: { from: a.layers, to: b.layers } } : {}),
    holes: added(before.pcb.holes, after.pcb.holes, hole, byId),
  }
}

const shown = (value: unknown) => {
  const text = value === undefined ? "none" : typeof value === "string" ? value : JSON.stringify(value)
  return text.length > MAX_RULE_TEXT ? `${text.slice(0, MAX_RULE_TEXT - 3)}...` : text
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The leaves of the rules that differ, by dotted path, in path order. */
function rulesDiff(before: unknown, after: unknown, path = "", out: DesignDiff["rules"] = []): DesignDiff["rules"] {
  if (isObject(before) && isObject(after)) {
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(naturalCompare)) {
      rulesDiff(before[key], after[key], path ? `${path}.${key}` : key, out)
    }
    return out
  }
  if (JSON.stringify(before) !== JSON.stringify(after) && out.length < MAX_RULES) out.push({ path, from: shown(before), to: shown(after) })
  return out
}

/** The design-rule findings and the diagnostics about the code, each with a key that stays the same from build to build. */
function checksOf(design: Design): CheckAt[] {
  const violations = design.violations.map((v) => ({ id: v.id, code: v.code, severity: v.severity, message: v.message, ...(v.at ? { at: v.at } : {}) }))
  const diagnostics = design.diagnostics.map((d) => ({ id: `${d.code}:${d.items.join(",")}:${d.message}`, code: d.code, severity: d.severity, message: d.message }))
  return [...violations, ...diagnostics]
}

const errorsFirst = (a: CheckAt, b: CheckAt) =>
  a.severity === b.severity ? naturalCompare(a.message, b.message) || naturalCompare(a.id, b.id) : a.severity === "error" ? -1 : 1

function schematicMoves(before: Design, after: Design): string[] {
  const was = new Map(before.circuit.components.map((one) => [one.id, JSON.stringify(one.sch)]))
  return after.circuit.components
    .filter((one) => was.has(one.id) && was.get(one.id) !== JSON.stringify(one.sch))
    .map((one) => one.id)
    .sort(naturalCompare)
}

/** What changed from `before` to `after`; when a side did not build, which one and why, and nothing else. */
export function diffDesigns(before: BuiltSide, after: BuiltSide): DesignDiff {
  if ("error" in before || "error" in after) {
    const side = "error" in before && "error" in after ? "both" : "error" in before ? "before" : "after"
    const message = "error" in after ? after.error : "error" in before ? before.error : ""
    return { ...EMPTY, failed: { side, message } }
  }
  const a = before.design
  const b = after.design
  const parts = partsDiff(a, b)
  const checks = added(checksOf(a), checksOf(b), (check) => check.id, errorsFirst)
  return {
    parts,
    nets: netsDiff(a, b, parts),
    ...copperDiff(a, b),
    board: boardDiff(a, b),
    // The rules carry the path of the file they came from, which is not a rule.
    rules: rulesDiff({ ...a.rules, file: undefined }, { ...b.rules, file: undefined }),
    checks: { appeared: checks.added, went: checks.removed },
    schematic: { moved: schematicMoves(a, b) },
  }
}

/** Whether anything on the board changed: parts placed, copper, pours, the board or its holes. */
export function onBoard(diff: DesignDiff): boolean {
  const { parts, tracks, vias, pours, board } = diff
  const lists = [parts.added, parts.removed, parts.moved, parts.renamed, tracks.added, tracks.removed, vias.added, vias.removed, pours.added, pours.removed, board.holes.added, board.holes.removed]
  return lists.some((list) => list.length > 0) || board.outline || board.layers !== undefined
}
