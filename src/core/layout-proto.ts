// The paths of a perfboard or stripboard in the layout file, one JSON line each beside the copper: a run of solder
// along neighbouring holes (`s1`), a wire link on the top between two holes in one row or column (`w1`), and a cut of a
// stripboard's strip at a hole or between two holes (`x1`). Holes are named as on the board ("C7": row C, column 7).
// Only the fields are checked here; whether a step is to a neighbour or a link is straight needs the board's grid and
// is a finding of the build (engine/proto/checks.ts). Pure text handling.
import { parseHole } from "../engine/proto/grid.js"
import type { LayoutMaker } from "./layout-file.js"

interface ProtoCommon {
  id: string
  locked: boolean
  by: LayoutMaker
}

export interface SolderRecord extends ProtoCommon {
  t: "solder"
  net?: string
  /** At least two holes, each a neighbour of the one before. */
  holes: string[]
}

export interface LinkRecord extends ProtoCommon {
  t: "link"
  net?: string
  from: string
  to: string
}

export interface CutRecord extends ProtoCommon {
  t: "cut"
  /** The strip drilled away at this hole. */
  at?: string
  /** Or cut between these two neighbouring holes. */
  between?: [string, string]
}

export type ProtoRecord = SolderRecord | LinkRecord | CutRecord
export type ProtoKindName = ProtoRecord["t"]

export const PROTO_RECORD_KINDS = ["solder", "link", "cut"] as const
const FIELDS: Record<ProtoKindName, readonly string[]> = {
  solder: ["t", "id", "net", "holes", "locked", "by"],
  link: ["t", "id", "net", "from", "to", "locked", "by"],
  cut: ["t", "id", "at", "between", "locked", "by"],
}
const PREFIX: Record<ProtoKindName, string> = { solder: "s", link: "w", cut: "x" }
const MAKERS: readonly LayoutMaker[] = ["human", "agent", "router"]
/** The most holes one solder run may list. */
export const MAX_SOLDER_HOLES = 400

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const isHole = (value: unknown): value is string => typeof value === "string" && parseHole(value) !== undefined
export const isProtoKind = (value: unknown): value is ProtoKindName => PROTO_RECORD_KINDS.includes(value as ProtoKindName)
const idPattern = (t: ProtoKindName) => new RegExp(`^${PREFIX[t]}([1-9]\\d*)$`)

function holeProblems(raw: Record<string, unknown>): string[] {
  if (raw.t === "solder") {
    if (!Array.isArray(raw.holes) || raw.holes.length < 2 || raw.holes.length > MAX_SOLDER_HOLES) return [`holes must list 2 to ${MAX_SOLDER_HOLES} holes`]
    const bad = raw.holes.findIndex((hole) => !isHole(hole))
    return bad < 0 ? [] : [`holes[${bad}] must be a hole name such as C7`]
  }
  if (raw.t === "link") {
    const problems = [isHole(raw.from) ? "" : "from must be a hole name such as C7", isHole(raw.to) ? "" : "to must be a hole name such as C7"].filter((p) => p !== "")
    return problems.length === 0 && raw.from === raw.to ? ["a link joins two different holes"] : problems
  }
  if ((raw.at === undefined) === (raw.between === undefined)) return ["a cut has at (a hole) or between (two holes), one of them"]
  if (raw.at !== undefined) return isHole(raw.at) ? [] : ["at must be a hole name such as C7"]
  const pair = raw.between
  return Array.isArray(pair) && pair.length === 2 && pair.every(isHole) && pair[0] !== pair[1] ? [] : ["between must be two different hole names, such as [\"C7\", \"C8\"]"]
}

/** The problems with one record's fields, none when it is good. */
function problemsOf(raw: Record<string, unknown>, t: ProtoKindName): string[] {
  const problems = Object.keys(raw)
    .filter((key) => !FIELDS[t].includes(key))
    .map((key) => `unknown field ${key}`)
  if (raw.net !== undefined && (typeof raw.net !== "string" || raw.net === "")) problems.push("net must be a non-empty string when given")
  if (raw.locked !== undefined && typeof raw.locked !== "boolean") problems.push("locked must be true or false")
  if (raw.by !== undefined && !MAKERS.includes(raw.by as LayoutMaker)) problems.push(`by must be one of ${MAKERS.join(", ")}`)
  return [...problems, ...holeProblems(raw)]
}

/** One solder, link or cut line checked; in canonical form with its defaults, or its problems. */
export function checkProto(raw: Record<string, unknown>): { record: ProtoRecord } | { problems: string[]; id?: string } {
  const t = raw.t
  if (!isProtoKind(t)) return { problems: ['t must be "solder", "link" or "cut"'] }
  if (typeof raw.id !== "string" || !idPattern(t).test(raw.id)) return { problems: [`id must look like ${PREFIX[t]}1`] }
  const problems = problemsOf(raw, t)
  if (problems.length > 0) return { problems, id: raw.id }
  const common = { id: raw.id, locked: raw.locked === true, by: (raw.by ?? "human") as LayoutMaker }
  const net = typeof raw.net === "string" ? { net: raw.net } : {}
  if (t === "solder") return { record: { t, ...common, ...net, holes: [...(raw.holes as string[])] } }
  if (t === "link") return { record: { t, ...common, ...net, from: raw.from as string, to: raw.to as string } }
  const where = raw.at !== undefined ? { at: raw.at as string } : { between: [...(raw.between as string[])] as [string, string] }
  return { record: { t, ...common, ...where } }
}

/** One line per record, fields in a fixed order, a newline after each. */
export function serializeProto(records: readonly ProtoRecord[]): string {
  return records
    .map((record) => {
      const source = record as unknown as Record<string, unknown>
      return `${JSON.stringify(Object.fromEntries(FIELDS[record.t].filter((key) => source[key] !== undefined).map((key) => [key, source[key]])))}\n`
    })
    .join("")
}

/** The id the next record of a kind gets: one past the highest of that kind there. */
export function nextProtoId(records: readonly ProtoRecord[], t: ProtoKindName): string {
  const pattern = idPattern(t)
  const highest = Math.max(0, ...records.filter((r) => r.t === t).map((r) => Number(pattern.exec(r.id)?.[1] ?? 0)))
  return `${PREFIX[t]}${highest + 1}`
}

/** "solder s1 C3–D4", "link w2 C3–C9", "cut x1 at C7", "cut x2 between C7 and C8". */
export function protoWords(record: ProtoRecord): string {
  if (record.t === "solder") return `solder ${record.id} ${record.holes[0]}–${record.holes[record.holes.length - 1]}`
  if (record.t === "link") return `link ${record.id} ${record.from}–${record.to}`
  return record.at !== undefined ? `cut ${record.id} at ${record.at}` : `cut ${record.id} between ${record.between?.[0]} and ${record.between?.[1]}`
}
