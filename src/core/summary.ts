import type { HistoryListing } from "./history.js"
import type { CircuitModel, PropInfo } from "./types.js"
import type { LoadedCircuit } from "./workspace.js"

/** A compact, line-oriented description of a circuit for agents and terminals. */
export function formatSummary(circuit: LoadedCircuit): string {
  const { model, annotations } = circuit
  const locked = new Set(annotations.locks.map((lock) => lock.part))
  const drawings = model.drawings.length > 0 ? `, ${model.drawings.length} drawings` : ""
  const lines = [`${circuit.file}: ${model.parts.length} parts, ${model.traces.length} traces${drawings}`, "Parts:"]

  for (const part of model.parts) {
    const flags = [locked.has(part.name) ? "[LOCKED]" : "", part.readonlyReason ? `[read-only: ${part.readonlyReason}]` : ""]
    lines.push(`  ${[part.name, `<${part.tag}>`, ...flags, formatProps(part.props)].filter(Boolean).join(" ")}`)
  }
  for (const skipped of model.skipped) {
    lines.push(`  (not editable) <${skipped.tag}> on line ${skipped.line}: ${skipped.reason}`)
  }

  lines.push("Traces:")
  for (const trace of model.traces) {
    const ends = trace.editable ? oneLine(`${trace.from} -> ${trace.to}`) : `line ${trace.line} [read-only: ${trace.readonlyReason}]`
    lines.push(`  ${[ends, formatProps(trace.props)].filter(Boolean).join(" ")}`)
  }

  lines.push(...drawingLines(model, locked), ...boardItemLines(model, locked))

  if (annotations.marks.length > 0) {
    lines.push("Marks from the human:")
    for (const mark of annotations.marks) {
      const at = mark.view ? ` (${mark.view} ${mark.x ?? "?"}, ${mark.y ?? "?"})` : ""
      lines.push(`  ${mark.id}${at}: ${oneLine(mark.text)}`)
    }
  }

  if (circuit.violations.length === 0) {
    lines.push("Lock violations: none")
  } else {
    lines.push("Lock violations (restore these parts):")
    for (const v of circuit.violations) lines.push(`  ${v.part} ${v.kind}: ${oneLine(v.detail)}`)
  }
  return lines.join("\n")
}

/** Drawings by id; a repeat (a piece of a bus, say) also shows the name it shares. Nothing when there are none. */
function drawingLines(model: CircuitModel, locked: ReadonlySet<string>): string[] {
  if (model.drawings.length === 0) return []
  return [
    "Drawings:",
    ...model.drawings.map((drawing) => {
      const flags = [locked.has(drawing.id) ? "[LOCKED]" : "", drawing.readonlyReason ? `[read-only: ${drawing.readonlyReason}]` : ""]
      const shared = drawing.name !== undefined && drawing.name !== drawing.id ? `name=${JSON.stringify(drawing.name)}` : ""
      return `  ${[oneLine(drawing.id), `<${drawing.tag}>`, ...flags, shared, formatProps(drawing.props)].filter(Boolean).join(" ")}`
    }),
  ]
}

/** Copper pours and holes by id, each marked when locked. Nothing when there are none. */
function boardItemLines(model: CircuitModel, locked: ReadonlySet<string>): string[] {
  const items = model.boardItems ?? []
  if (items.length === 0) return []
  return [
    "Pours and holes:",
    ...items.map((item) => {
      const flags = [locked.has(item.id) ? "[LOCKED]" : "", item.readonlyReason ? `[read-only: ${item.readonlyReason}]` : ""]
      return `  ${[item.id, `<${item.tag}>`, ...flags, formatProps(item.props)].filter(Boolean).join(" ")}`
    }),
  ]
}

export function formatHistory(entries: HistoryListing[], problems: readonly { file: string; reason: string }[] = []): string {
  const skipped = problems.map((p) => `Skipped ${p.file}: ${oneLine(p.reason)}`)
  if (entries.length === 0) return ["No changes recorded yet.", ...skipped].join("\n")
  const rows = entries.map((e) => `${e.id}  ${e.time}  ${e.author}  ${e.summary}  (${[e.file, ...(e.also ?? []).map((other) => other.file)].join(", ")})${e.undone ? " [undone]" : ""}${e.redoneAs ? ` [redone as ${e.redoneAs}]` : ""}`)
  return [...rows, ...skipped].join("\n")
}

/** Marks a prop whose value is written as code (not a plain value): set_props cannot change it, the rest of the part can be. */
const CODE_VALUE = " (code: set_props cannot change it)"

function formatProps(props: Record<string, PropInfo>): string {
  return Object.entries(props)
    .map(([key, prop]) => `${prop.source ? `${key}=${oneLine(prop.source)}` : key}${prop.editable ? "" : CODE_VALUE}`)
    .join(" ")
}

/** Keeps every item on one line, so multi-line values cannot imitate other summary lines. */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ")
}
