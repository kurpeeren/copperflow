import type { Diagnostic, Severity } from "../engine/model.js"
import type { Violation } from "../engine/index.js"
import { buildWith, type DesignSource } from "./design-source.js"
import { oneLine } from "./summary.js"
import { resolveCircuit } from "./workspace.js"

export interface IssueGroup {
  type: string
  count: number
  /** The first few messages of this type, each with its position. */
  messages: string[]
}

export interface CheckResult {
  ok: boolean
  errors: IssueGroup[]
  warnings: IssueGroup[]
  violations: Violation[]
  diagnostics: Diagnostic[]
}

export interface CheckOptions {
  /** Builds the design whose findings the check reports; without one, a new engine is started and stopped. */
  engine?: DesignSource
}

const MESSAGES_PER_GROUP = 3
const MAX_TEXT = 300

interface Issue {
  severity: Severity
  code: string
  text: string
}

/**
 * Checks a circuit with copperflow's own rules. The engine builds the design the Studio, the BOM and
 * the package use; its rule violations (ERC and placement DRC) and its diagnostics about the code and
 * the model are grouped by code. Any error fails the check. Circuit code the engine cannot run is
 * thrown as file:line:column.
 */
export async function checkCircuit(root: string, file: string, options: CheckOptions = {}): Promise<CheckResult> {
  const circuit = await resolveCircuit(root, file)
  const design = await buildWith(root, circuit.file, options.engine)
  const issues = [...design.violations.map(fromViolation), ...design.diagnostics.map(fromDiagnostic)]
  const errors = groupIssues(issues, "error")
  return {
    ok: errors.length === 0,
    errors,
    warnings: groupIssues(issues, "warning"),
    violations: [...design.violations],
    diagnostics: [...design.diagnostics],
  }
}

export function formatCheck(file: string, result: CheckResult): string {
  const total = (groups: IssueGroup[]) => groups.reduce((sum, g) => sum + g.count, 0)
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
  const lines = [
    `${file}: check ${result.ok ? "passed" : "failed"}, ${plural(total(result.errors), "error")}, ${plural(total(result.warnings), "warning")}`,
  ]
  for (const [title, groups] of [
    ["Errors:", result.errors],
    ["Warnings:", result.warnings],
  ] as const) {
    if (groups.length === 0) continue
    lines.push(title)
    for (const group of groups) lines.push(...formatGroup(group))
  }
  return lines.join("\n")
}

function formatGroup(group: IssueGroup): string[] {
  const hidden = group.count - group.messages.length
  return [
    `  ${group.type}${group.count > 1 ? ` (${group.count})` : ""}:`,
    ...group.messages.map((message) => `    ${message}`),
    ...(hidden > 0 ? [`    … and ${hidden} more`] : []),
  ]
}

/** The message is clipped, then its position added, so a long message never loses where it is. */
function fromViolation(v: Violation): Issue {
  return { severity: v.severity, code: v.code, text: `${clip(v.message)}${violationPlace(v)}` }
}

function violationPlace(v: Violation): string {
  if (v.view === "schematic") return " at the schematic"
  return v.at ? ` at ${v.at.x.toFixed(2)}, ${v.at.y.toFixed(2)} mm` : ""
}

function fromDiagnostic(d: Diagnostic): Issue {
  const place = d.source ? ` at ${d.source.file}:${d.source.line}:${d.source.column}` : ""
  return { severity: d.severity, code: d.code, text: `${clip(d.message)}${oneLine(place)}` }
}

/** Issues of one severity grouped by code in the order codes first appear, each with a count and its first few messages. */
function groupIssues(issues: readonly Issue[], severity: Severity): IssueGroup[] {
  const groups = new Map<string, IssueGroup>()
  for (const issue of issues.filter((i) => i.severity === severity)) {
    const type = clip(issue.code)
    const previous = groups.get(type) ?? { type, count: 0, messages: [] }
    const messages = previous.messages.length < MESSAGES_PER_GROUP ? [...previous.messages, issue.text] : previous.messages
    groups.set(type, { type, count: previous.count + 1, messages })
  }
  return [...groups.values()]
}

function clip(text: string): string {
  const flat = oneLine(text)
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT)}…` : flat
}
