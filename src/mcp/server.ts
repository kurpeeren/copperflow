import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { checkCircuit, editCircuit, formatHistory, listHistory, listParts, redoChange, undoChange, type Edit } from "../core/index.js"
import type { DesignSource } from "../core/bom.js"
import { buildWith } from "../core/design-source.js"
import { VERSION } from "../version.js"
import { planNets } from "./batch.js"
import { formatCompactCheck } from "./compact.js"
import { DESCRIBE_SHEET_DESCRIPTION, describeSheetInput, describeSheetTool } from "./sheet-card-tools.js"
import * as project from "./project-tools.js"
import * as router from "./route-tools.js"
import * as placer from "./place-tools.js"
import * as folded from "./folded-tools.js"
import { CREATE_PART_DESCRIPTION, createPartInput, createPartTool } from "./create-part.js"
import { SIMULATE_DESCRIPTION, simulateInput } from "./simulate-tool.js"
import { simulate } from "../core/simulate.js"
import { IMPORT_PART_DESCRIPTION, importPart, importPartInput } from "./import-part.js"
import { IMPORT_GRAPHIC_DESCRIPTION, importGraphicInput, importGraphicTool } from "./graphic-tool.js"
import { MAKE_SHEET_DESCRIPTION, makeSheet, makeSheetInput } from "./make-sheet.js"
import { NEW_CIRCUIT_DESCRIPTION, newCircuit, newCircuitInput } from "./new-circuit.js"
import { compactToolList } from "./compact-tool-list.js"
import { createGuideMemory, GUIDE_DESCRIPTION, guideInSession, guideInput, skillResources } from "./guide.js"
import { RENDER_DESCRIPTION, renderInput, renderTool } from "./render-tool.js"
import { changeTarget, changeText, changeView } from "../core/change-view.js"
import { registerModuleTools } from "./module-tools.js"
import { OPEN_STUDIO_DESCRIPTION, openStudio, openStudioInput } from "./open-studio.js"
import { partInfo } from "./part-tools.js"
import { SET_RULES_DESCRIPTION, setRulesInput, setRulesTool } from "./rules-tool.js"
import type { Renderer } from "../core/render.js"
import { currentReporter, tellToolActivity, type Reporter } from "./tool-activity.js"
import { studioLink, type StudioLink } from "./studio-activity.js"
import { SUMMARY_DESCRIPTION, summaryInput, summaryTool } from "./summary-tool.js"
import { EXPORT_DESCRIPTION, exportInput, exportTool } from "./export-tool.js"
import { EDIT_DESCRIPTION, editInput, editTool } from "./edit-tool.js"

/** The opening line and the rules that hold wherever the server runs. */
const INSTRUCTIONS_INTRO = "copperflow lets you design circuit boards (*.circuit.tsx files) together with a human, who edits the same files in the Studio."
const INSTRUCTIONS_RULES = `- Change circuit files through these tools wherever one does the change: each call is one history entry the human can undo, and the tools enforce locks. Write code by hand only for what no tool writes.
- Never change, move or remove anything marked [LOCKED]; if a summary lists lock violations, restore those parts. "Marks from the human" are instructions; follow them. Do not redo a change the human undid.
- There is no tool to unlock a part or verify a library part: only the human does that.`

const INSTRUCTIONS = `${INSTRUCTIONS_INTRO}
- Call project_status first in every task, then follow the copperflow skill: its design workflow says which tool to call at each step and what its answer looks like.
${INSTRUCTIONS_RULES}
- Without the copperflow skill installed, call guide (no topic) for it, then guide { topic } for a reference it names.
- When the person asks to open copperflow or to see the board, call open_studio and give them the address it returns.
- A new board starts with a plan, before any circuit file: guide { topic: "planning" } (the questions to ask the person, what to look up first, the blocks and their ports, one sub-agent per block).`

const file = z.string().describe("Circuit file")
const literal = z.union([z.string(), z.number(), z.boolean()])
const READ_ONLY = { readOnlyHint: true, destructiveHint: false }

export interface ServerOptions {
  /** Builds the design for check_circuit, circuit_summary and export; tests pass one that runs in this process. */
  engine?: DesignSource
  /** Fetches for import_part; tests pass one that answers from fixtures. */
  fetch?: typeof fetch
  /** Loads the renderer for render; tests pass the source module. */
  renderer?: () => Promise<Renderer>
  /** Where the agent's activity goes besides the client: this project's running Studio by default; null for none. */
  studio?: StudioLink | null
}

export function createCopperflowServer(root: string, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: "copperflow", version: VERSION }, { instructions: INSTRUCTIONS })
  const designOptions = options.engine ? { engine: options.engine } : {}

  const apply = async (circuit: string, edits: Edit[], summary: string, note = summary, after: string[] = []) => {
    const result = await editCircuit(root, circuit, edits, { author: "ai", summary, ...designOptions })
    const warnings = result.violations.map((v) => `Lock violation: ${v.part} ${v.kind}: ${v.detail}`)
    return [`Change ${result.entry.id} applied: ${note}`, ...(result.copperNote ? [result.copperNote] : []), ...after, ...warnings].join("\n")
  }
  const edit = (circuit: string, edits: Edit[], summary: string) => run(() => apply(circuit, edits, summary))
  /** add_trace's nets form: one connection per pin not yet on its net, as one change, and the pins added per net. */
  const connectNets = (circuit: string, nets: Record<string, string[]>) =>
    run(async () => {
      const plan = await planNets(root, circuit, nets, options.engine)
      const counts = Object.entries(plan.added).map(([name, n]) => `${name} +${n}`).join(", ")
      if (plan.edits.length === 0) return `Nothing to do: all ${plan.skipped} pins are already on their nets.`
      const skipped = plan.skipped > 0 ? `; ${plan.skipped} already connected` : ""
      const added = Object.entries(plan.pins).map(([name, pins]) => `${name} +${pins.length}: ${pins.join(" ")}`)
      return apply(circuit, plan.edits, `connect nets ${counts}`, `connected ${plan.edits.length} pins (${counts}${skipped})`, added)
    })

  const ports = { root, ...(options.engine ? { engine: options.engine } : {}) }
  const renderer = options.renderer ? { renderer: options.renderer } : {}
  server.registerTool("circuit_summary", { description: SUMMARY_DESCRIPTION, inputSchema: summaryInput, annotations: READ_ONLY }, (input) => run(() => summaryTool(ports, input)))

  server.registerTool(
    "add_trace",
    {
      description:
        'Schematic trace (a connection, no copper): from and to, e.g. ".R1 > .pin1" to "net.GND"; or nets, many pins as ONE change, e.g. { "GND": ["R1.pin2", "C1.pin2"] }: pins on the net already are skipped, unknown pins refused; the answer lists the pins added.',
      inputSchema: {
        file,
        from: z.string().optional(),
        to: z.string().optional(),
        props: z.record(z.string(), literal).optional().describe('Extra trace props, e.g. { "thickness": "0.4mm" }'),
        nets: z.record(z.string(), z.array(z.string()).min(1)).optional(),
      },
    },
    ({ file: circuit, from, to, props, nets }) => {
      if (nets !== undefined) {
        if (from !== undefined || to !== undefined || props !== undefined) return run(async () => refuseTraceForm())
        return connectNets(circuit, nets)
      }
      if (from === undefined || to === undefined) return run(async () => refuseTraceForm())
      return edit(circuit, [{ kind: "addTrace", from, to, ...(props ? { props } : {}) }], `add trace ${from} -> ${to}`)
    },
  )

  server.registerTool(
    "check_circuit",
    {
      description:
        "Check electrical, placement, copper and pour rules: the error and warning counts, then up to 20 findings. Run it after autoplace, after autoroute and after removing copper; fix the errors before reporting success.",
      inputSchema: { file, filter: z.string().optional().describe('"errors", "warnings", "copper", a part, net, rule or instance') },
      annotations: READ_ONLY,
    },
    ({ file: circuit, filter }) =>
      run(async () => formatCompactCheck(circuit, await checkCircuit(root, circuit, designOptions), filter)),
  )

  server.registerTool("route_track", { description: folded.ROUTE_DESCRIPTION, inputSchema: folded.routeInput }, (input) => run(() => folded.routeTool(ports, input)))
  server.registerTool(
    "remove_copper",
    { description: folded.REMOVE_DESCRIPTION, inputSchema: folded.removeInput, annotations: { destructiveHint: true } },
    (input) => run(() => folded.removeTool(ports, input)),
  )
  server.registerTool("fillet_tracks", { description: folded.FILLET_DESCRIPTION, inputSchema: folded.filletInput }, (input) => run(() => folded.filletTool(ports, input)))
  // The two long runs hear the client's cancel (extra.signal): the worker is ended and nothing is written afterwards.
  server.registerTool("autoplace", { description: placer.AUTOPLACE_DESCRIPTION, inputSchema: placer.autoplaceInput }, (input, extra) => run((report) => placer.autoplace(ports, input, { report, signal: extra.signal })))
  server.registerTool("fit_board", { description: folded.FIT_DESCRIPTION, inputSchema: folded.fitInput }, (input) => run(() => folded.fitTool(ports, input)))
  server.registerTool("set_rules", { description: SET_RULES_DESCRIPTION, inputSchema: setRulesInput }, (input) => run(() => setRulesTool(ports, input)))
  server.registerTool("import_graphic", { description: IMPORT_GRAPHIC_DESCRIPTION, inputSchema: importGraphicInput }, (input) => run(() => importGraphicTool(ports, input)))
  server.registerTool("autoroute", { description: router.AUTOROUTE_DESCRIPTION, inputSchema: router.autorouteInput }, (input, extra) => run((report) => router.autoroute(ports, input, { report, signal: extra.signal })))
  // Not read-only: out writes the picture into the project.
  server.registerTool("render", { description: RENDER_DESCRIPTION, inputSchema: renderInput, annotations: { readOnlyHint: false, destructiveHint: false } }, (input) =>
    renderTool({ ...ports, ...renderer, report: currentReporter() }, input),
  )
  server.registerTool("project_status", { description: project.PROJECT_STATUS_DESCRIPTION, inputSchema: {}, annotations: READ_ONLY }, () => run(() => project.projectStatus(ports)))
  server.registerTool("note_decision", { description: folded.NOTE_DESCRIPTION, inputSchema: folded.noteInput }, (input) => run(() => folded.noteTool(ports, input)))

  server.registerTool(
    "new_circuit",
    { description: NEW_CIRCUIT_DESCRIPTION, inputSchema: newCircuitInput },
    (input) => run(() => newCircuit(root, input, options.engine)),
  )

  server.registerTool("describe_sheet", { description: DESCRIBE_SHEET_DESCRIPTION, inputSchema: describeSheetInput }, (input) => run(() => describeSheetTool(root, input)))
  server.registerTool("simulate", { description: SIMULATE_DESCRIPTION, inputSchema: simulateInput, annotations: READ_ONLY }, (input) => run(() => simulate(root, input, options.engine)))
  server.registerTool("make_sheet", { description: MAKE_SHEET_DESCRIPTION, inputSchema: makeSheetInput }, (input) => run(() => makeSheet(root, input, options.engine)))
  server.registerTool("edit_circuit", { description: EDIT_DESCRIPTION, inputSchema: editInput }, (input) => run(() => editTool(ports, input)))

  server.registerTool("list_parts", { description: folded.LIST_PARTS_DESCRIPTION, inputSchema: folded.listPartsInput, annotations: READ_ONLY }, ({ id }) =>
    run(async () => {
      if (id !== undefined) return partInfo(root, id)
      const parts = await listParts(root)
      if (parts.length === 0) return "The parts library is empty. Create parts with create_part."
      return parts
        .map((p) => `${p.id}  <${p.component}>  ${p.title}  ${p.footprint}  ${p.verified ? "verified" : "NOT verified"}${p.origin ? `  ${p.origin}` : ""}`)
        .join("\n")
    }),
  )

  server.registerTool("create_part", { description: CREATE_PART_DESCRIPTION, inputSchema: createPartInput }, (input) => run(() => createPartTool(root, input)))
  server.registerTool("set_part_fields", { description: folded.PART_FIELDS_DESCRIPTION, inputSchema: folded.partFieldsInput }, (input) => run(() => folded.partFieldsTool(root, input)))
  // One server is one MCP session (stdio: the process), so this memory is the session's.
  const guideSeen = createGuideMemory()
  server.registerTool("guide", { description: GUIDE_DESCRIPTION, inputSchema: guideInput, annotations: READ_ONLY }, (input) => run(() => guideInSession(guideSeen, input)))
  for (const resource of skillResources()) {
    server.registerResource(resource.name, resource.uri, { mimeType: "text/markdown" }, async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: await readFile(fileURLToPath(resource.file), "utf8") }],
    }))
  }

  server.registerTool("import_part", { description: IMPORT_PART_DESCRIPTION, inputSchema: importPartInput, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } }, (input) => run(() => importPart(root, input, options.fetch)))

  server.registerTool("export", { description: EXPORT_DESCRIPTION, inputSchema: exportInput, annotations: { readOnlyHint: false, destructiveHint: false } }, (input) =>
    exportTool({ ...ports, ...renderer, report: currentReporter() }, input),
  )

  server.registerTool(
    "recent_changes",
    {
      description: "List recent changes by you and the human, newest first, with undos and redos. id: what one change did; since: all after it.",
      inputSchema: { limit: z.number().int().min(1).max(200).optional(), id: z.string().optional(), since: z.string().optional() },
      annotations: READ_ONLY,
    },
    ({ limit, id, since }) => run(async () => {
      const target = changeTarget(id, since)
      if (target) return changeText(await changeView(root, target, options.engine ? { engine: options.engine } : {}))
      const { entries, problems } = await listHistory(root, limit ?? 20)
      return formatHistory(entries, problems)
    }),
  )

  server.registerTool(
    "undo_change",
    {
      description:
        'Undo one of your own changes: the newest, or the given id. A human\'s "Redo:" of it is theirs; you cannot undo it. redo: true redoes one of your own undos instead: the newest, or the given id (the undo\'s or the undone change\'s); a human\'s undo is theirs, you cannot redo it.',
      inputSchema: { id: z.string().optional().describe("e.g. c0003"), redo: z.boolean().optional() },
    },
    ({ id, redo }) =>
      run(async () => {
        // The built design tells which tracks start on locked parts, so copper can be undone while parts are locked.
        const design = (circuit: string) => buildWith(root, circuit, options.engine)
        const request = { author: "ai" as const, design, ...(id ? { id } : {}) }
        const entry = redo === true ? await redoChange(root, request) : await undoChange(root, request)
        return `Change ${entry.id} applied: ${entry.summary}`
      }),
  )

  server.registerTool("open_studio", { description: OPEN_STUDIO_DESCRIPTION, inputSchema: openStudioInput, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }, (input) => run(() => openStudio({ root }, input)))
  registerModuleTools(server, root, run, options.engine)
  compactToolList(server)
  tellToolActivity(server, options.studio === null ? undefined : (options.studio ?? studioLink({ root })))
  return server
}

/** add_trace takes from and to (one connection) or nets (many pins), never both. */
function refuseTraceForm(): never {
  throw new Error('Give from and to for one connection, or nets for many pins, e.g. { "GND": ["R1.pin2", "C1.pin2"] }; not both. Nothing was written.')
}

/** The tool's text as its answer, or its error as an error answer; the task gets the call's reporter (tool-activity.ts). */
async function run(task: (report: Reporter) => Promise<string>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: await task(currentReporter()) }] }
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: (error as Error).message }] }
  }
}
