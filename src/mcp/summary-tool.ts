// circuit_summary: the circuit, its board, its copper or its bill of materials, one view at a time. Each view is the
// summary a tool of its own gave before the tool fold (board_summary, copper_summary, bom), with the same lines.
import { z } from "zod"
import { bomWithReport, formatBomMarkdown, formatSummary, loadCircuit, resolveCircuit } from "../core/index.js"
import { buildWith, type DesignSource } from "../core/design-source.js"
import { readCard } from "../core/sheet-card.js"
import { lockedNames } from "../studio/place-runner.js"
import { formatBoardSummary } from "./board-summary.js"
import { formatCompactSummary, formatInstanceSummary, formatPartSummary, type SheetView } from "./compact.js"
import { importsSheet, instanceAt, type Flattened } from "./compact-sheets.js"
import { buildOf, type Ports } from "./copper-tools.js"
import { formatCopperSummary } from "./copper-summary.js"
import { instanceCard, withCard } from "./sheet-card-tools.js"

const SHEET_FILE = /\.sheet\.tsx$/

export const SUMMARY_VIEWS = ["circuit", "board", "copper", "bom"] as const
type View = (typeof SUMMARY_VIEWS)[number]

export const summaryInput = {
  file: z.string().describe("Circuit file"),
  view: z.enum(SUMMARY_VIEWS).optional().describe('Default "circuit"'),
  detail: z.enum(["compact", "full"]).optional().describe('circuit, board; default "compact"'),
  filter: z.string().optional().describe("circuit only: a part or instance, e.g. J2 or PS1"),
}

export const SUMMARY_DESCRIPTION =
  'Summarize a circuit. view "circuit": one line per part and per net, then locked parts, marks from the human and lock violations; filter shows one part or sub-sheet instance; detail "full" lists every prop and trace. "board": about 60 lines: size, layers, courtyard use, a line per part (position, side, [LOCKED] or "not placed"), the ten longest connections, overlaps, parts off the board, pours, silkscreen texts, drawings, unrouted count. "copper": at most 60 lines: totals, per net (tracks, vias, unrouted), pours and holes by id, violations by rule; call it before and after drawing copper. "bom": the parts grouped, and whether the board is ready to order.'

interface SummaryInput {
  file: string
  view?: View | undefined
  detail?: "compact" | "full" | undefined
  filter?: string | undefined
}

/** The summary the view asks for; filter belongs to the circuit view and detail to the circuit and board views. */
export async function summaryTool(ports: Ports, input: SummaryInput): Promise<string> {
  const view = input.view ?? "circuit"
  if (view !== "circuit" && input.filter !== undefined) throw new Error(`filter is for view "circuit"; view "${view}" shows the whole design`)
  if ((view === "copper" || view === "bom") && input.detail !== undefined) throw new Error(`detail is for view "circuit" or "board"; view "${view}" has one form`)
  if (view === "board") return boardView(ports, input.file, input.detail)
  if (view === "copper") return formatCopperSummary(input.file, await buildOf(ports, input.file))
  if (view === "bom") {
    const { lines, report } = await bomWithReport(ports.root, input.file, ports.engine ? { engine: ports.engine } : {})
    return `${formatBomMarkdown(lines)}\n${report}`
  }
  return circuitView(ports, input)
}

async function boardView(ports: Ports, circuit: string, detail: "compact" | "full" | undefined): Promise<string> {
  const resolved = await resolveCircuit(ports.root, circuit)
  const design = await buildOf(ports, resolved.file)
  return formatBoardSummary(resolved.file, design, new Set(await lockedNames(resolved.path, design)), detail)
}

async function circuitView(ports: Ports, input: SummaryInput): Promise<string> {
  const { root, engine } = ports
  const loaded = await loadCircuit(root, input.file)
  if (input.filter) return filteredView(loaded, await flatDesign(root, loaded.file, engine), input.filter)
  const card = (text: string) => (SHEET_FILE.test(loaded.file) ? withCard(text, readCard(loaded.source)) : text)
  if (input.detail === "full") return card(formatSummary(loaded))
  const usesSheets = loaded.model.imports.some((spec) => importsSheet(spec.source))
  return card(formatCompactSummary(loaded, usesSheets ? await sheetView(root, input.file, engine) : undefined))
}

/** One part, or one sub-sheet instance with its card when it has one; anything else is refused naming the instances. */
function filteredView(loaded: Awaited<ReturnType<typeof loadCircuit>>, flat: Flattened, filter: string): string {
  const isInstance = (flat.instances ?? []).some((instance) => instance.path === filter)
  const part = isInstance ? undefined : formatPartSummary(loaded, flat, filter)
  if (part !== undefined) return part
  if (!isInstance) {
    const instances = (flat.instances ?? []).map((instance) => instance.path)
    const also = instances.length > 0 ? `; the instances are ${instances.join(", ")}` : ""
    throw new Error(`There is no part or sub-sheet instance ${filter} in ${loaded.file}${also}`)
  }
  const card = instanceCard(instanceAt(loaded.file, flat, filter))
  const described = card.does !== undefined || card.ports.some((port) => port.type || port.carries)
  return described ? withCard(formatInstanceSummary(loaded, flat, filter), card) : formatInstanceSummary(loaded, flat, filter)
}

/** The flattened design, for a summary of one instance; a build that fails is the answer. */
async function flatDesign(root: string, circuit: string, engine: DesignSource | undefined): Promise<Flattened> {
  const view = await sheetView(root, circuit, engine)
  if ("failure" in view) throw new Error(`The circuit does not build, so its instances cannot be shown: ${view.failure}`)
  return view.flat
}

/** The flattened design of a circuit with sub-sheets, or why it could not be built; the summary is given either way. */
async function sheetView(root: string, circuit: string, engine: DesignSource | undefined): Promise<SheetView> {
  try {
    const { circuit: built } = await buildWith(root, circuit, engine)
    return { flat: built }
  } catch (error) {
    return { failure: error instanceof Error ? error.message : String(error) }
  }
}
