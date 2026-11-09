/**
 * The layout file: `<name>.circuit.layout.json` beside `<name>.circuit.tsx`, one JSON record per line, holding the
 * copper a person, the agent or the router drew. Pure text handling: no file system here (layout-edits.ts writes it).
 */

export interface LayoutPoint {
  x: number
  y: number
}

export const COPPER_LAYERS = ["top", "bottom", "inner1", "inner2"] as const
export type CopperLayer = (typeof COPPER_LAYERS)[number]
export const LAYOUT_MAKERS = ["human", "agent", "router"] as const
/** Who drew a record. */
export type LayoutMaker = (typeof LAYOUT_MAKERS)[number]

/** A track: points in mm, board coordinates, at least two. `net` is a net name ("GND") or a net id. */
export interface TrackRecord {
  t: "track"
  id: string
  net?: string
  layer: CopperLayer
  width: number
  points: LayoutPoint[]
  locked: boolean
  by: LayoutMaker
}

export interface ViaRecord {
  t: "via"
  id: string
  net?: string
  at: LayoutPoint
  drill: number
  diameter: number
  layers: CopperLayer[]
  locked: boolean
  by: LayoutMaker
}

export type LayoutRecord = TrackRecord | ViaRecord

const CIRCUIT_SUFFIX = ".circuit.tsx"
const LAYOUT_SUFFIX = ".circuit.layout.json"
const ID_PATTERN = { track: /^t(\d{4,})$/, via: /^v(\d{4,})$/ } as const
const ID_PREFIX = { track: "t", via: "v" } as const
const ID_DIGITS = 4
const TRACK_FIELDS = ["t", "id", "net", "layer", "width", "points", "locked", "by"] as const
const VIA_FIELDS = ["t", "id", "net", "at", "drill", "diameter", "layers", "locked", "by"] as const

/** `boards/main.circuit.tsx` keeps its copper in `boards/main.circuit.layout.json`. */
export function layoutPathFor(circuitFile: string): string {
  if (!circuitFile.endsWith(CIRCUIT_SUFFIX)) throw new Error(`${circuitFile} is not a *.circuit.tsx file`)
  return `${circuitFile.slice(0, -CIRCUIT_SUFFIX.length)}${LAYOUT_SUFFIX}`
}

export function isLayoutFile(file: string): boolean {
  return file.endsWith(LAYOUT_SUFFIX)
}

/** The circuit file a layout file belongs to. */
export function circuitPathFor(layoutFile: string): string {
  if (!isLayoutFile(layoutFile)) throw new Error(`${layoutFile} is not a *.circuit.layout.json file`)
  return `${layoutFile.slice(0, -LAYOUT_SUFFIX.length)}${CIRCUIT_SUFFIX}`
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const isPoint = (value: unknown): value is LayoutPoint =>
  isObject(value) && Object.keys(value).length === 2 && Number.isFinite(value.x) && Number.isFinite(value.y)
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0
const isLayer = (value: unknown): value is CopperLayer => COPPER_LAYERS.includes(value as CopperLayer)

/** The problems with the fields both kinds share. */
function commonProblems(raw: Record<string, unknown>, fields: readonly string[]): string[] {
  const problems = Object.keys(raw)
    .filter((key) => !fields.includes(key))
    .map((key) => `unknown field ${key}`)
  if (raw.net !== undefined && (typeof raw.net !== "string" || raw.net === "")) problems.push("net must be a non-empty string when given")
  if (raw.locked !== undefined && typeof raw.locked !== "boolean") problems.push("locked must be true or false")
  if (raw.by !== undefined && !LAYOUT_MAKERS.includes(raw.by as LayoutMaker)) problems.push(`by must be one of ${LAYOUT_MAKERS.join(", ")}`)
  return problems
}

function trackProblems(raw: Record<string, unknown>): string[] {
  const problems = commonProblems(raw, TRACK_FIELDS)
  if (!isLayer(raw.layer)) problems.push(`layer must be one of ${COPPER_LAYERS.join(", ")}`)
  if (!positive(raw.width)) problems.push("width must be a number above 0")
  if (!Array.isArray(raw.points) || raw.points.length < 2) return [...problems, "points must hold at least two points"]
  const bad = raw.points.findIndex((p) => !isPoint(p))
  if (bad >= 0) problems.push(`points[${bad}] must be {x, y} with finite numbers`)
  return problems
}

function viaProblems(raw: Record<string, unknown>): string[] {
  const problems = commonProblems(raw, VIA_FIELDS)
  if (!isPoint(raw.at)) problems.push("at must be {x, y} with finite numbers")
  if (!positive(raw.drill)) problems.push("drill must be a number above 0")
  if (!positive(raw.diameter)) problems.push("diameter must be a number above 0")
  else if (positive(raw.drill) && raw.diameter <= raw.drill) problems.push("diameter must be larger than drill")
  const layers = raw.layers ?? ["top", "bottom"]
  if (!Array.isArray(layers) || !layers.every(isLayer)) problems.push(`layers must list layers from ${COPPER_LAYERS.join(", ")}`)
  else if (new Set(layers).size !== layers.length || layers.length < 2) problems.push("layers must name at least two different layers")
  return problems
}

const point = (p: LayoutPoint): LayoutPoint => ({ x: p.x, y: p.y })

/** A checked record in the canonical field order, with the defaults filled in. */
function canonical(raw: Record<string, unknown>): LayoutRecord {
  const net = typeof raw.net === "string" ? { net: raw.net } : {}
  const tail = { locked: raw.locked === true, by: (raw.by ?? "human") as LayoutMaker }
  if (raw.t === "track") {
    const { layer, width, points } = raw as unknown as TrackRecord
    return { t: "track", id: raw.id as string, ...net, layer, width, points: points.map(point), ...tail }
  }
  const { at, drill, diameter } = raw as unknown as ViaRecord
  const layers = (raw.layers ?? ["top", "bottom"]) as CopperLayer[]
  return { t: "via", id: raw.id as string, ...net, at: point(at), drill, diameter, layers: [...layers], ...tail }
}

/** Checks one record; returns it in canonical form, or the problems, the id first when it has one. */
export function checkRecord(raw: unknown): { record: LayoutRecord } | { problems: string[]; id?: string } {
  if (!isObject(raw)) return { problems: ["must be a JSON object"] }
  if (raw.t !== "track" && raw.t !== "via") return { problems: ['t must be "track" or "via"'] }
  if (typeof raw.id !== "string" || !ID_PATTERN[raw.t].test(raw.id)) return { problems: [`id must look like ${ID_PREFIX[raw.t]}0001`] }
  const problems = raw.t === "track" ? trackProblems(raw) : viaProblems(raw)
  return problems.length > 0 ? { problems, id: raw.id } : { record: canonical(raw) }
}

/** The number each kind's next id gets: ids handed out once are never handed out again in the file. */
export interface LayoutCounters {
  track: number
  via: number
}

/** A layout file's content: the counters (the file's first line, when any id was ever given) and the records in order. */
export interface LayoutDoc {
  next: LayoutCounters
  records: LayoutRecord[]
}

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1

/** `{"t":"meta","next":{"track":12,"via":3}}`, or the problem with it. */
function checkMeta(raw: Record<string, unknown>): LayoutCounters | string {
  const next = raw.next
  const extra = Object.keys(raw).find((key) => key !== "t" && key !== "next")
  if (extra !== undefined) return `unknown field ${extra}`
  if (!isObject(next) || Object.keys(next).some((key) => key !== "track" && key !== "via") || !isCount(next.track) || !isCount(next.via)) {
    return "next must be {track, via} with whole numbers from 1"
  }
  return { track: next.track, via: next.via }
}

type ParsedLine = { record: LayoutRecord } | { meta: LayoutCounters } | { error: string }

function parseLine(line: string, number: number): ParsedLine {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return { error: `line ${number} is not valid JSON` }
  }
  if (isObject(raw) && raw.t === "meta") {
    const meta = checkMeta(raw)
    return typeof meta === "string" ? { error: `line ${number} (meta): ${meta}` } : { meta }
  }
  const checked = checkRecord(raw)
  if ("record" in checked) return checked
  const where = checked.id === undefined ? `line ${number}` : `line ${number} (${checked.id})`
  return { error: `${where}: ${checked.problems.join("; ")}` }
}

const idNumber = (record: LayoutRecord) => Number(ID_PATTERN[record.t].exec(record.id)?.[1] ?? 0)

/** The counters: the meta line's, raised past every id in the file, so a hand edit cannot make an id come back. */
function countersFor(records: readonly LayoutRecord[], meta: LayoutCounters | undefined): LayoutCounters {
  const after = (kind: LayoutRecord["t"]) => Math.max(meta?.[kind] ?? 1, ...records.filter((r) => r.t === kind).map((r) => idNumber(r) + 1))
  return { track: after("track"), via: after("via") }
}

/**
 * Reads every valid record in file order and names each problem by its line; a repeated id keeps the first. The
 * meta line may only be the first line.
 */
export function parseLayout(text: string): LayoutDoc & { errors: string[] } {
  const records: LayoutRecord[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  let meta: LayoutCounters | undefined
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === "") return
    const parsed = parseLine(line, index + 1)
    if ("error" in parsed) errors.push(parsed.error)
    else if ("meta" in parsed) {
      if (seen.size > 0 || meta !== undefined || errors.length > 0) errors.push(`line ${index + 1}: the meta line must be the first line`)
      else meta = parsed.meta
    } else if (seen.has(parsed.record.id)) errors.push(`line ${index + 1}: ${parsed.record.id} is used twice`)
    else {
      seen.add(parsed.record.id)
      records.push(parsed.record)
    }
  })
  return { next: countersFor(records, meta), records, errors }
}

/** Reads a layout file that must be valid throughout; the error names the file and every problem. */
export function readLayoutText(text: string, file = "The layout file"): LayoutDoc {
  const { next, records, errors } = parseLayout(text)
  if (errors.length > 0) throw new Error(`${file}: ${errors.join("; ")}`)
  return { next, records }
}

/** The records alone, one line each, fields in a fixed order, a newline after each. */
export function serializeRecords(records: readonly LayoutRecord[]): string {
  return records
    .map((record) => {
      const fields: readonly string[] = record.t === "track" ? TRACK_FIELDS : VIA_FIELDS
      const source = record as unknown as Record<string, unknown>
      return `${JSON.stringify(Object.fromEntries(fields.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])))}\n`
    })
    .join("")
}

/** The file's text: the meta line once any id was given (it stays when every record is removed), then the records. */
export function serializeLayout(doc: LayoutDoc): string {
  const used = doc.next.track > 1 || doc.next.via > 1
  const meta = used ? `${JSON.stringify({ t: "meta", next: { track: doc.next.track, via: doc.next.via } })}\n` : ""
  return meta + serializeRecords(doc.records)
}

/** The id the next record of that kind gets: t0001, t0002, … */
export function nextLayoutId(doc: LayoutDoc, kind: LayoutRecord["t"]): string {
  return `${ID_PREFIX[kind]}${String(doc.next[kind]).padStart(ID_DIGITS, "0")}`
}

export const EMPTY_LAYOUT: LayoutDoc = { next: { track: 1, via: 1 }, records: [] }
