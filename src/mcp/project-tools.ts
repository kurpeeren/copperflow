// The project memory tools. project_status is the first call a fresh context makes: PROJECT.md's Intent, Blocks, the
// last five Decisions and Open, then per circuit file its counts and its last three changes. note_decision (a decision,
// or with open an item under Open) and set_project write PROJECT.md through the core, one history entry by the agent each.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { listCircuits, listEntries, resolveCircuit, type HistoryListing } from "../core/index.js"
import { layoutPathFor } from "../core/layout-file.js"
import { MAX_OPEN_ITEMS, noteDecision, noteOpen, readProject, setProject, type ProjectUpdate } from "../core/project.js"
import { PROJECT_PATH, sectionLines, sectionText } from "../core/project-text.js"
import type { Design } from "../engine/design.js"
import { buildOf, type Ports } from "./copper-tools.js"
import { rulesLine } from "./rules-tool.js"

const DECISIONS_SHOWN = 5
const CHANGES_SHOWN = 3
/** project_status reads this many recent history entries to find each circuit's last changes. */
const HISTORY_READ = 500

export const noteDecisionInput = {
  file: z.string().optional(),
  text: z.string().min(1).max(500).describe('e.g. "TJA1051 over MCP2551: 3.3 V I/O"'),
  open: z.boolean().optional().describe("true: add the text as one item under Open (still to do or to ask) instead"),
}

const MAX_BLOCKS = 50
const MAX_INTENT_CHARS = 2000

/** The refusal for a field: its name, the rule it broke and one valid value. */
const INTENT_RULE = `intent must be a string of at most ${MAX_INTENT_CHARS} characters, e.g. "A CAN node for the bench."`
const BLOCKS_RULE = `blocks must be an array of at most ${MAX_BLOCKS} objects, each with a non-empty name and the strings does and status, e.g. [{ "name": "CAN", "does": "MCP2515 + TJA1051 transceiver", "status": "placed" }]`
const OPEN_RULE = `open must be an array of at most ${MAX_OPEN_ITEMS} non-empty strings, e.g. ["route the board"]`

export const setProjectInput = {
  intent: z.string(INTENT_RULE).max(MAX_INTENT_CHARS, INTENT_RULE).optional().describe("One paragraph"),
  blocks: z
    .array(z.object({ name: z.string(BLOCKS_RULE).min(1, BLOCKS_RULE), does: z.string(BLOCKS_RULE), status: z.string(BLOCKS_RULE) }, BLOCKS_RULE), BLOCKS_RULE)
    .max(MAX_BLOCKS, BLOCKS_RULE)
    .optional()
    .describe('e.g. [{ name: "CAN", does: "TJA1051 transceiver", status: "placed" }]'),
  open: z
    .array(z.string(OPEN_RULE).min(1, OPEN_RULE), OPEN_RULE)
    .max(MAX_OPEN_ITEMS, OPEN_RULE)
    .optional()
    .describe('e.g. ["route the board"]'),
}

export const PROJECT_STATUS_DESCRIPTION =
  "Call this first in every task: PROJECT.md (intent, blocks, last decisions, open items), then per circuit file its counts, unplaced, unrouted, errors, warnings and last changes."
export const NOTE_DECISION_DESCRIPTION =
  "Note a design decision in PROJECT.md as one dated line, as ONE change: each choice a later context should not undo (a part and why, a board size, what the person approved). With open: true the text is instead one item added to Open (a part to verify, a question for the person); set_project { open } rewrites that list."
export const SET_PROJECT_DESCRIPTION =
  `Rewrite sections of PROJECT.md as ONE change: intent (at most ${MAX_INTENT_CHARS} characters), blocks (an array of at most ${MAX_BLOCKS} { name, does, status }) and open (an array of at most ${MAX_OPEN_ITEMS} non-empty strings). Sections not given and Decisions stay.`

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

/**
 * The changes, newest first, that touched a circuit: written to its file, its layout file or a sheet file it uses, or
 * with one of those among the files written alongside.
 */
export function changesOf(file: string, sheets: readonly string[], history: readonly HistoryListing[]): HistoryListing[] {
  const own = new Set([file, layoutPathFor(file), ...sheets])
  return history.filter((e) => own.has(e.file) || (e.also ?? []).some((change) => own.has(change.file)))
}

async function circuitLines(ports: Ports, file: string, history: readonly HistoryListing[]): Promise<string[]> {
  let counts: string
  let sheets: string[] = []
  try {
    const design = await buildOf(ports, file)
    counts = circuitCounts(design)
    sheets = [...new Set((design.circuit.instances ?? []).map((instance) => instance.file))]
  } catch (error) {
    counts = `could not be built: ${(error as Error).message.split("\n")[0]}`
  }
  const changes = changesOf(file, sheets, history).slice(0, CHANGES_SHOWN)
  return [`${file}: ${counts}`, ...changes.map(changeLine)]
}

export async function projectStatus(ports: Ports): Promise<string> {
  const circuits = await listCircuits(ports.root)
  const history = await listEntries(ports.root, HISTORY_READ)
  const perCircuit = []
  for (const file of circuits) perCircuit.push(...(await circuitLines(ports, file, history)))
  return [
    ...projectLines(await readProject(ports.root)),
    await rulesLine(ports.root),
    circuits.length === 0 ? "Circuits: none yet (new_circuit starts one)" : `Circuits (${circuits.length}):`,
    ...perCircuit,
  ].join("\n")
}

/** The note's text, led by the circuit file it is about; a file that does not exist is refused. */
async function aboutCircuit(ports: Ports, input: { file?: string | undefined; text: string }): Promise<string> {
  const about = input.file === undefined ? undefined : (await resolveCircuit(ports.root, input.file)).file
  if (about !== undefined && !existsSync(join(ports.root, about))) throw new Error(`There is no circuit file ${about}. Nothing was written.`)
  return about === undefined ? input.text : `${about}: ${input.text}`
}

export async function noteDecisionTool(ports: Ports, input: { file?: string | undefined; text: string; open?: boolean | undefined }): Promise<string> {
  if (input.open === true) return noteOpenItem(ports, input)
  const entry = await noteDecision(ports.root, await aboutCircuit(ports, input), { author: "ai" })
  return `Change ${entry.id}: noted under Decisions in ${PROJECT_PATH}`
}

/** note_decision { open: true }: one item at the end of Open, and how many there are now. */
async function noteOpenItem(ports: Ports, input: { file?: string | undefined; text: string }): Promise<string> {
  const entry = await noteOpen(ports.root, await aboutCircuit(ports, input), { author: "ai" })
  const count = sectionLines((await readProject(ports.root)) ?? "", "Open").length
  return `Change ${entry.id}: added to Open in ${PROJECT_PATH} (${count} open item${count === 1 ? "" : "s"})`
}

export async function setProjectTool(ports: Ports, input: ProjectUpdate): Promise<string> {
  const entry = await setProject(ports.root, input, { author: "ai" })
  return `Change ${entry.id}: ${entry.summary.replace(/^Set project /, "")} written to ${PROJECT_PATH}`
}
