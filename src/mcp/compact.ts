import type { CheckResult, LoadedCircuit, PartInfo, TraceInfo } from "../core/index.js"
import { oneLine } from "../core/summary.js"

/** Lists in a default answer stop here, so the whole answer fits a screen. */
export const COMPACT_LIMIT = 20
const PINS_PER_NET = 12
const ITEMS_PER_ISSUE = 6
const VALUE_PROPS = ["resistance", "capacitance", "inductance", "color", "voltage"]

const natural = new Intl.Collator("en", { numeric: true })

function capped(lines: string[], limit = COMPACT_LIMIT): string[] {
  if (lines.length <= limit) return lines
  return [...lines.slice(0, limit), `… and ${lines.length - limit} more (detail: "full")`]
}

/** `.R1 > .pin1` and `R1.pin1` both become `R1.pin1`; `net.GND` stays a net. */
export function pinName(selector: string): string {
  const flat = oneLine(selector).trim()
  const match = /^\.([\w-]+)\s*>\s*\.([\w-]+)$/.exec(flat)
  return match ? `${match[1]}.${match[2]}` : flat
}

export interface Net {
  names: string[]
  pins: string[]
}

/** Groups the traces' endpoints into nets: endpoints joined by a trace are on the same net. */
export function netsOf(traces: readonly TraceInfo[]): Net[] {
  const parent = new Map<string, string>()
  const find = (key: string): string => {
    const up = parent.get(key) ?? key
    if (up === key) return key
    const root = find(up)
    parent.set(key, root)
    return root
  }
  for (const trace of traces) {
    if (trace.from === undefined || trace.to === undefined) continue
    const [a, b] = [pinName(trace.from), pinName(trace.to)]
    for (const key of [a, b]) if (!parent.has(key)) parent.set(key, key)
    parent.set(find(a), find(b))
    parent.set(a, find(b))
  }
  const groups = new Map<string, string[]>()
  for (const key of parent.keys()) groups.set(find(key), [...(groups.get(find(key)) ?? []), key])
  return [...groups.values()].map((members) => ({
    names: members.filter((m) => m.startsWith("net.")).map((m) => m.slice(4)).sort(natural.compare),
    pins: members.filter((m) => !m.startsWith("net.")).sort(natural.compare),
  }))
}

function netLine(net: Net): string {
  const shown = net.pins.slice(0, PINS_PER_NET)
  const more = net.pins.length - shown.length
  return `${net.names.join("=") || "(unnamed)"}: ${shown.join(" ")}${more > 0 ? ` … and ${more} more` : ""}`
}

function literalOf(part: PartInfo, key: string): string | undefined {
  const prop = part.props[key]
  if (!prop) return undefined
  return String(prop.literal ?? prop.source)
}

function at(part: PartInfo, view: string, x: string, y: string): string {
  const [px, py] = [literalOf(part, x), literalOf(part, y)]
  return px === undefined && py === undefined ? "" : `${view}(${px ?? "?"},${py ?? "?"})`
}

function partLine(part: PartInfo, locked: ReadonlySet<string>): string {
  const value = VALUE_PROPS.map((key) => literalOf(part, key)).find((v) => v !== undefined)
  const flags = [locked.has(part.name) ? "[LOCKED]" : "", part.readonlyReason ? `[read-only: ${oneLine(part.readonlyReason)}]` : ""]
  const places = [at(part, "@sch", "schX", "schY"), at(part, "pcb", "pcbX", "pcbY")]
  return [part.name, part.tag, value, literalOf(part, "footprint"), ...places, ...flags].filter(Boolean).join(" ")
}

/** The default circuit_summary: counts, one line per part and net, locks, marks and lock violations. */
export function formatCompactSummary(circuit: LoadedCircuit): string {
  const { model, annotations } = circuit
  const lockedNames = annotations.locks.map((lock) => lock.part)
  const locked = new Set(lockedNames)
  const nets = netsOf(model.traces).sort((a, b) => Number(b.names.length > 0) - Number(a.names.length > 0) || natural.compare(a.names[0] ?? "", b.names[0] ?? ""))
  const lines = [`${circuit.file}: ${model.parts.length} parts, ${nets.length} nets, ${model.traces.length} traces, ${locked.size} locked`]
  lines.push(...capped(model.parts.map((part) => partLine(part, locked))))
  lines.push(...capped(nets.map(netLine)))
  if (model.skipped.length > 0) lines.push(`Not editable: ${model.skipped.length} elements (detail: "full")`)
  if (lockedNames.length > 0) {
    const more = lockedNames.length - COMPACT_LIMIT
    lines.push(`Locked: ${lockedNames.slice(0, COMPACT_LIMIT).join(" ")}${more > 0 ? ` … and ${more} more (detail: "full")` : ""}`)
  }
  const marks = annotations.marks.map((mark) => `Mark ${mark.id}${mark.view ? ` (${mark.view} ${mark.x ?? "?"}, ${mark.y ?? "?"})` : ""}: ${oneLine(mark.text)}`)
  lines.push(...capped(marks))
  const broken = circuit.violations.map((v) => `  ${v.part} ${v.kind}: ${oneLine(v.detail)}`)
  lines.push(broken.length === 0 ? "Lock violations: none" : `Lock violations: ${broken.length} (restore these parts)`)
  lines.push(...capped(broken))
  return lines.join("\n")
}

interface Finding {
  severity: "error" | "warning"
  rule: string
  items: string[]
  text: string
}

function findings(result: CheckResult): Finding[] {
  const place = (v: CheckResult["violations"][number]) =>
    v.view === "schematic" ? " at the schematic" : v.at ? ` at ${v.at.x.toFixed(2)}, ${v.at.y.toFixed(2)} mm` : ""
  const fromViolations = result.violations.map((v) => ({ severity: v.severity, rule: v.code, items: v.items, text: `${oneLine(v.message)}${place(v)}` }))
  const fromDiagnostics = result.diagnostics.map((d) => {
    const where = d.source ? ` at ${d.source.file}:${d.source.line}:${d.source.column}` : ""
    return { severity: d.severity, rule: d.code, items: d.items, text: `${oneLine(d.message)}${where}` }
  })
  return [...fromViolations, ...fromDiagnostics].filter((f): f is Finding => f.severity === "error" || f.severity === "warning")
}

function matches(finding: Finding, filter: string | undefined): boolean {
  if (filter === undefined || filter === "") return true
  if (filter === "errors") return finding.severity === "error"
  if (filter === "warnings") return finding.severity === "warning"
  const needle = filter.toLowerCase()
  const whole = (item: string) => item.toLowerCase() === needle || item.toLowerCase().startsWith(`${needle}.`)
  return finding.items.some((item) => whole(item) || whole(item.replace(/^net[.:]/, "")))
}

function findingLine(f: Finding): string {
  const shown = f.items.slice(0, ITEMS_PER_ISSUE).join(", ")
  const more = f.items.length > ITEMS_PER_ISSUE ? ` … +${f.items.length - ITEMS_PER_ISSUE}` : ""
  return `${f.severity} ${f.rule}${shown ? ` [${shown}${more}]` : ""}: ${f.text}`
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** The default check_circuit: counts, then up to 20 violations, one line each, errors first. */
export function formatCompactCheck(file: string, result: CheckResult, filter?: string): string {
  const all = findings(result).filter((f) => matches(f, filter))
  const sorted = [...all.filter((f) => f.severity === "error"), ...all.filter((f) => f.severity === "warning")]
  const errors = sorted.filter((f) => f.severity === "error").length
  const head = `${file}: ${plural(errors, "error")}, ${plural(sorted.length - errors, "warning")}${filter ? ` (filter: ${filter})` : ""}`
  const lines = sorted.map(findingLine)
  const more = lines.length > COMPACT_LIMIT ? [`… and ${lines.length - COMPACT_LIMIT} more (narrow with filter: errors, warnings, a part or a net)`] : []
  return [head, ...lines.slice(0, COMPACT_LIMIT), ...more].join("\n")
}
