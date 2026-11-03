import type { HistoryListing } from "./history.js"
import type { PropInfo } from "./types.js"
import type { LoadedCircuit } from "./workspace.js"

/** A compact, line-oriented description of a circuit for agents and terminals. */
export function formatSummary(circuit: LoadedCircuit): string {
  const { model, annotations } = circuit
  const locked = new Set(annotations.locks.map((lock) => lock.part))
  const lines = [`${circuit.file}: ${model.parts.length} parts, ${model.traces.length} traces`, "Parts:"]

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

export function formatHistory(entries: HistoryListing[]): string {
  if (entries.length === 0) return "No changes recorded yet."
  return entries
    .map((e) => `${e.id}  ${e.time}  ${e.author}  ${e.summary}  (${e.file})${e.undone ? " [undone]" : ""}`)
    .join("\n")
}

function formatProps(props: Record<string, PropInfo>): string {
  return Object.entries(props)
    .map(([key, prop]) => `${prop.source ? `${key}=${oneLine(prop.source)}` : key}${prop.editable ? "" : " (read-only)"}`)
    .join(" ")
}

/** Keeps every item on one line, so multi-line values cannot imitate other summary lines. */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ")
}
