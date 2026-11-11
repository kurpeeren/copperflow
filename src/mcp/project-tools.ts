// The project memory tools. project_status is the first call a fresh context makes: PROJECT.md's Intent, Blocks, the
// last five Decisions and Open, then per circuit file its counts and its last three changes. note_decision and
// set_project write PROJECT.md through the core, one history entry by the agent each.
import { z } from "zod"
import { listCircuits, listEntries, type HistoryListing } from "../core/index.js"
import { noteDecision, readProject, setProject, type ProjectUpdate } from "../core/project.js"
import { PROJECT_PATH, sectionLines, sectionText } from "../core/project-text.js"
import type { Design } from "../engine/design.js"
import { buildOf, type Ports } from "./copper-tools.js"

const DECISIONS_SHOWN = 5
const CHANGES_SHOWN = 3
/** project_status reads this many recent history entries to find each circuit's last changes. */
const HISTORY_READ = 500

export const noteDecisionInput = {
  text: z.string().min(1).max(500).describe('The decision in one line, e.g. "TJA1051 over MCP2551: 3.3 V I/O"'),
}

export const setProjectInput = {
  intent: z.string().max(2000).optional().describe("What the design is for, in one paragraph"),
  blocks: z
    .array(z.object({ name: z.string().min(1), does: z.string(), status: z.string() }))
    .max(50)
    .optional()
    .describe('Every block, one each: { name: "CAN", does: "MCP2515 + TJA1051 transceiver", status: "placed" }'),
  open: z.array(z.string().min(1)).max(50).optional().describe("What is left to do, one item each"),
}

export const PROJECT_STATUS_DESCRIPTION =
  "Call this first in every task. Answers in a screenful: the project's PROJECT.md (Intent, Blocks, the last five Decisions, Open), then per circuit file its parts, nets, unplaced parts, unrouted connections, errors and warnings, and its last three changes. Without a PROJECT.md the answer says so; set_project writes one."
export const NOTE_DECISION_DESCRIPTION =
  "Note a design decision in PROJECT.md: one dated line under Decisions, as ONE change. Note each choice a later context should not undo (a part chosen and why, a board size, what the person approved)."
export const SET_PROJECT_DESCRIPTION =
  "Rewrite sections of PROJECT.md as ONE change: intent (one paragraph), blocks (one line each: name, what it does, status) and open (what is left). Sections not given and Decisions stay as they are. Creates PROJECT.md when the project has none."

/** "parts 12, nets 9, unplaced 0, unrouted 3, errors 0, warnings 2" */
export function circuitCounts(design: Design): string {
  const findings = [...design.violations, ...design.diagnostics]
  const count = (severity: string) => findings.filter((f) => f.severity === severity).length
  const unplaced = design.pcb.parts.filter((p) => p.autoPlaced).length
  return `parts ${design.circuit.components.length}, nets ${design.circuit.nets.length}, unplaced ${unplaced}, unrouted ${design.pcb.ratsnest.length}, errors ${count("error")}, warnings ${count("warning")}`
}

const changeLine = (e: HistoryListing) => `  ${e.id} ${e.time.slice(0, 10)} ${e.author}: ${e.summary}${e.undone ? " (undone)" : ""}`

/** PROJECT.md's sections as answer lines. */
export function projectLines(text: string | undefined): string[] {
  if (text === undefined) return [`No ${PROJECT_PATH} yet: write the Intent and Blocks with set_project.`]
  const intent = sectionText(text, "Intent")
  const blocks = sectionLines(text, "Blocks")
  const decisions = sectionLines(text, "Decisions")
  const open = sectionLines(text, "Open")
  const shown = decisions.slice(-DECISIONS_SHOWN)
  return [
    `Intent: ${intent === "" ? "(none)" : intent}`,
    `Blocks: ${blocks.length === 0 ? "(none)" : ""}`.trimEnd(),
    ...blocks.map((b) => `  ${b}`),
    `Decisions${decisions.length > shown.length ? ` (last ${shown.length} of ${decisions.length})` : ""}: ${shown.length === 0 ? "(none)" : ""}`.trimEnd(),
    ...shown.map((d) => `  ${d}`),
    `Open: ${open.length === 0 ? "(none)" : ""}`.trimEnd(),
    ...open.map((o) => `  ${o}`),
  ]
}

async function circuitLines(ports: Ports, file: string, history: readonly HistoryListing[]): Promise<string[]> {
  let counts: string
  try {
    counts = circuitCounts(await buildOf(ports, file))
  } catch (error) {
    counts = `could not be built: ${(error as Error).message.split("\n")[0]}`
  }
  const changes = history.filter((e) => e.file === file).slice(0, CHANGES_SHOWN)
  return [`${file}: ${counts}`, ...changes.map(changeLine)]
}

export async function projectStatus(ports: Ports): Promise<string> {
  const circuits = await listCircuits(ports.root)
  const history = await listEntries(ports.root, HISTORY_READ)
  const perCircuit = []
  for (const file of circuits) perCircuit.push(...(await circuitLines(ports, file, history)))
  return [
    ...projectLines(await readProject(ports.root)),
    circuits.length === 0 ? "Circuits: none yet (new_circuit starts one)" : `Circuits (${circuits.length}):`,
    ...perCircuit,
  ].join("\n")
}

export async function noteDecisionTool(ports: Ports, input: { text: string }): Promise<string> {
  const entry = await noteDecision(ports.root, input.text, { author: "ai" })
  return `Change ${entry.id}: noted under Decisions in ${PROJECT_PATH}`
}

export async function setProjectTool(ports: Ports, input: ProjectUpdate): Promise<string> {
  const entry = await setProject(ports.root, input, { author: "ai" })
  return `Change ${entry.id}: ${entry.summary.replace(/^Set project /, "")} written to ${PROJECT_PATH}`
}
