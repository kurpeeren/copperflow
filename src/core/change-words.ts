// A change in words, for the agent (recent_changes), the CLI (history <id>) and the Studio's change bar: at most 30
// lines, the important first, ending with what was left out as counts.
import type { DesignDiff, PartAt } from "../engine/design-diff.js"
import { onBoard } from "../engine/design-diff.js"
import type { Point } from "../engine/model.js"
import type { ChangeTarget } from "./change-files.js"
import type { HistoryEntry } from "./history.js"

export const MAX_CHANGE_LINES = 30
/** The most part names one count line lists. */
const MAX_NAMES = 8

/** What a line is about; the left-out line counts them by this. */
export type LineKind =
  | "title"
  | "failed"
  | "unsure"
  | "error"
  | "removed"
  | "added"
  | "renamed"
  | "net"
  | "pins"
  | "edited"
  | "board"
  | "rule"
  | "warning"
  | "gone"
  | "moved"
  | "copper"
  | "schematic"
  | "file"
  | "note"
  | "left"

export interface ChangeLine {
  text: string
  kind: LineKind
  /** Where on the board it is, for the view to centre on. */
  at?: Point
}

/** How a file's text changed, by lines. */
export interface FileCount {
  file: string
  added: number
  removed: number
  /** The file is new, or was deleted. */
  state?: "new" | "deleted"
}

const LEFT_OUT: Record<LineKind, [string, string]> = {
  title: ["title", "titles"],
  failed: ["build failure", "build failures"],
  unsure: ["unsure file", "unsure files"],
  error: ["new error", "new errors"],
  removed: ["part removed", "parts removed"],
  added: ["part added", "parts added"],
  renamed: ["part renamed", "parts renamed"],
  net: ["net change", "net changes"],
  pins: ["pin line", "pin lines"],
  edited: ["part edit", "part edits"],
  board: ["board change", "board changes"],
  rule: ["rule change", "rule changes"],
  warning: ["new warning", "new warnings"],
  gone: ["check gone", "checks gone"],
  moved: ["move line", "move lines"],
  copper: ["copper line", "copper lines"],
  schematic: ["schematic line", "schematic lines"],
  file: ["file", "files"],
  note: ["note", "notes"],
  left: ["", ""],
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
const who = (author: HistoryEntry["author"]) => (author === "ai" ? "the agent" : "the person")

/** "Change c0004 by the agent: <summary>", or "Since c0003: 3 changes, c0004 to c0006 (2 by the agent, 1 by the person)". */
export function changeTitle(target: ChangeTarget, entries: readonly Pick<HistoryEntry, "id" | "author" | "summary">[]): string {
  if ("id" in target) {
    const entry = entries[0]
    return entry ? `Change ${entry.id} by ${who(entry.author)}: ${entry.summary}` : `Change ${target.id}`
  }
  if (entries.length === 0) return `Since ${target.since}: no changes`
  const agent = entries.filter((entry) => entry.author === "ai").length
  const person = entries.length - agent
  const by = [agent > 0 ? `${agent} by the agent` : "", person > 0 ? `${person} by the person` : ""].filter(Boolean).join(", ")
  const span = entries.length === 1 ? (entries[0] as { id: string }).id : `${entries[0]?.id} to ${entries.at(-1)?.id}`
  return `Since ${target.since}: ${plural(entries.length, "change", "changes")}, ${span} (${by})`
}

const lineCount = (text: string | undefined) => (text === undefined || text === "" ? [] : text.replace(/\n$/, "").split("\n"))

/** Lines added and removed in each changed file, counted as multisets of lines. */
export function fileCounts(before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>, changed: readonly string[]): FileCount[] {
  return changed.map((file) => {
    const old = lineCount(before[file])
    const now = lineCount(after[file])
    const left = new Map<string, number>()
    for (const line of old) left.set(line, (left.get(line) ?? 0) + 1)
    let added = 0
    for (const line of now) {
      const count = left.get(line) ?? 0
      if (count > 0) left.set(line, count - 1)
      else added += 1
    }
    const removed = [...left.values()].reduce((sum, count) => sum + count, 0)
    const state = before[file] === undefined ? "new" : after[file] === undefined ? "deleted" : undefined
    return { file, added, removed, ...(state ? { state } : {}) }
  })
}

export function fileLine(count: FileCount): ChangeLine {
  if (count.state === "new") return { kind: "file", text: `File ${count.file}: new, ${plural(count.added, "line", "lines")}` }
  if (count.state === "deleted") return { kind: "file", text: `File ${count.file}: deleted, ${plural(count.removed, "line", "lines")}` }
  return { kind: "file", text: `File ${count.file}: ${plural(count.added, "line", "lines")} added, ${count.removed} removed` }
}

const where = (part: PartAt): Point => ({ x: part.x, y: part.y })
const about = (part: PartAt) => {
  const said = [part.value, part.footprint].filter((one) => one !== undefined)
  return said.length > 0 ? `${part.name} (${said.join(", ")})` : part.name
}
const names = (list: readonly string[]) => (list.length > MAX_NAMES ? `${list.slice(0, MAX_NAMES).join(", ")} and ${list.length - MAX_NAMES} more` : list.join(", "))

const FAILED_SIDE = { before: "Before the change", after: "After the change", both: "Before and after the change" } as const

function partLines(diff: DesignDiff): ChangeLine[] {
  const { parts } = diff
  return [
    ...parts.removed.map((part) => ({ kind: "removed" as const, text: `Removed ${about(part)}`, at: where(part) })),
    ...parts.added.map((part) => ({ kind: "added" as const, text: `Added ${about(part)}`, at: where(part) })),
    ...parts.renamed.map((r) => ({ kind: "renamed" as const, text: `Renamed ${r.from} to ${r.to}`, at: where(r.at) })),
  ]
}

/** Pins grouped by net: "GND: R3.pin1, U1.pin4 joined". */
function pinLines(diff: DesignDiff, partsAt: ReadonlyMap<string, Point>): ChangeLine[] {
  const grouped = (list: DesignDiff["nets"]["joined"], verb: string): ChangeLine[] => {
    const byNet = new Map<string, string[]>()
    for (const one of list) byNet.set(one.net, [...(byNet.get(one.net) ?? []), one.pin])
    return [...byNet].map(([net, pins]) => {
      const at = partsAt.get((pins[0] ?? "").split(".")[0] ?? "")
      return { kind: "pins" as const, text: `${net}: ${names(pins)} ${verb}`, ...(at ? { at } : {}) }
    })
  }
  return [...grouped(diff.nets.joined, "joined"), ...grouped(diff.nets.left, "left")]
}

function boardLines(diff: DesignDiff): ChangeLine[] {
  const { board } = diff
  const lines: ChangeLine[] = []
  if (board.size) lines.push({ kind: "board", text: `Board ${board.size.from} to ${board.size.to}` })
  else if (board.outline) lines.push({ kind: "board", text: "Board outline changed" })
  if (board.layers) lines.push({ kind: "board", text: `Board ${board.layers.from} to ${board.layers.to} layers` })
  const holes = counted(board.holes.added.length, board.holes.removed.length)
  if (holes) lines.push({ kind: "board", text: `Holes: ${holes}` })
  return lines
}

/** "1 added (8 mm), 1 removed (6 mm)"; empty when nothing was. */
function counted(added: number, removed: number, length?: (side: "added" | "removed") => string): string {
  const one = (count: number, side: "added" | "removed") => (count > 0 ? `${count} ${side}${length ? ` (${length(side)})` : ""}` : "")
  return [one(added, "added"), one(removed, "removed")].filter(Boolean).join(", ")
}

const mm = (value: number) => `${Math.round(value * 10) / 10} mm`
const middle = (points: readonly Point[]): Point | undefined => {
  const [a, b] = points
  return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a
}

function copperLines(diff: DesignDiff): ChangeLine[] {
  const lines: ChangeLine[] = []
  const { tracks, vias, pours } = diff
  const total = (side: "added" | "removed") => mm(tracks[side].reduce((sum, track) => sum + track.length, 0))
  const trackAt = middle((tracks.added[0] ?? tracks.removed[0])?.points ?? [])
  const track = counted(tracks.added.length, tracks.removed.length, total)
  if (track) lines.push({ kind: "copper", text: `Tracks: ${track}`, ...(trackAt ? { at: trackAt } : {}) })
  const viaAt = (vias.added[0] ?? vias.removed[0])?.at
  const via = counted(vias.added.length, vias.removed.length)
  if (via) lines.push({ kind: "copper", text: `Vias: ${via}`, ...(viaAt ? { at: viaAt } : {}) })
  const pour = counted(pours.added.length, pours.removed.length)
  if (pour) lines.push({ kind: "copper", text: `Pours: ${pour}` })
  return lines
}

function checkLines(diff: DesignDiff, severity: "error" | "warning"): ChangeLine[] {
  return diff.checks.appeared
    .filter((check) => check.severity === severity)
    .map((check) => ({ kind: severity, text: `New ${severity}: ${check.message}`, ...(check.at ? { at: check.at } : {}) }))
}

/** Every line, the important first, before the cap. */
export function bodyLines(diff: DesignDiff, unsure: readonly string[], files: readonly FileCount[]): ChangeLine[] {
  const failed: ChangeLine[] = diff.failed ? [{ kind: "failed", text: `${FAILED_SIDE[diff.failed.side]} the circuit code does not build: ${diff.failed.message}` }] : []
  const doubts = unsure.map((file): ChangeLine => ({ kind: "unsure", text: `Not sure of ${file}: it was edited by hand between changes` }))
  if (diff.failed) return [...failed, ...doubts, ...files.map(fileLine)]
  const partsAt = new Map<string, Point>([...diff.parts.removed, ...diff.parts.added].map((part) => [part.name, where(part)]))
  const moved = diff.parts.moved
  const lines: ChangeLine[] = [
    ...checkLines(diff, "error"),
    ...partLines(diff),
    ...diff.nets.appeared.map((net): ChangeLine => ({ kind: "net", text: `New net ${net}` })),
    ...diff.nets.went.map((net): ChangeLine => ({ kind: "net", text: `Net ${net} is gone` })),
    ...pinLines(diff, partsAt),
    ...diff.parts.changed.map((edit): ChangeLine => ({ kind: "edited", text: `${edit.name} ${edit.field} ${edit.from ?? "none"} to ${edit.to ?? "none"}` })),
    ...boardLines(diff),
    ...diff.rules.map((rule): ChangeLine => ({ kind: "rule", text: `Rule ${rule.path}: ${rule.from} to ${rule.to}` })),
    ...checkLines(diff, "warning"),
    ...diff.checks.went.map((check): ChangeLine => ({ kind: "gone", text: `Check gone: ${check.message}`, ...(check.at ? { at: check.at } : {}) })),
    ...(moved.length > 0 ? [{ kind: "moved" as const, text: `Moved ${plural(moved.length, "part", "parts")}: ${names(moved.map((m) => m.name))}`, at: where((moved[0] as { to: PartAt }).to) }] : []),
    ...copperLines(diff),
  ]
  const sheet = diff.schematic.moved
  const sheetLines: ChangeLine[] = sheet.length > 0 ? [{ kind: "schematic", text: `Schematic: ${plural(sheet.length, "symbol", "symbols")} moved (${names(sheet)})` }] : []
  if (lines.length === 0 && sheetLines.length === 0) return [...doubts, { kind: "note", text: "No difference in the built design" }, ...files.map(fileLine)]
  const note: ChangeLine[] = onBoard(diff) ? [] : [{ kind: "note", text: "Nothing on the board changed" }]
  return [...doubts, ...note, ...lines, ...sheetLines]
}

/** The title and the given lines, at most MAX_CHANGE_LINES in all, the last one counting what was left out. */
export function cappedLines(titleText: string, lines: readonly ChangeLine[]): ChangeLine[] {
  const title: ChangeLine = { kind: "title", text: titleText }
  if (lines.length + 1 <= MAX_CHANGE_LINES) return [title, ...lines]
  const kept = lines.slice(0, MAX_CHANGE_LINES - 2)
  const counts = new Map<LineKind, number>()
  for (const line of lines.slice(MAX_CHANGE_LINES - 2)) counts.set(line.kind, (counts.get(line.kind) ?? 0) + 1)
  const left = [...counts].map(([kind, count]) => plural(count, ...LEFT_OUT[kind])).join(", ")
  return [title, ...kept, { kind: "left", text: `Left out: ${left}` }]
}

/** The title and the lines of one circuit's change, at most MAX_CHANGE_LINES. */
export function changeLines(view: { title: string; diff: DesignDiff; unsure: readonly string[]; files: readonly FileCount[] }): ChangeLine[] {
  return cappedLines(view.title, bodyLines(view.diff, view.unsure, view.files))
}
