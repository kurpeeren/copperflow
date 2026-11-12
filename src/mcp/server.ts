import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import YAML from "yaml"
import {
  BUILTIN_PARTS,
  buildBom,
  exportFabrication,
  exportPackage,
  formatFabrication,
  formatBomMarkdown,
  listParts,
  partDir,
  PartSchema,
  placePart,
  readPart,
  checkCircuit,
  editCircuit,
  formatHistory,
  formatSummary,
  listCircuits,
  listHistory,
  loadCircuit,
  resolveCircuit,
  undoChange,
  type Edit,
} from "../core/index.js"
import type { DesignSource } from "../core/bom.js"
import { buildWith } from "../core/design-source.js"
import { FootprintFileSchema } from "../engine/footprints/file.js"
import { VERSION } from "../version.js"
import { batchSummary, describeRefusal, editItem, firstRefusal, moveNotes, planNets, toEdit, unknownPourNet } from "./batch.js"
import { formatCompactCheck, formatCompactSummary, formatInstanceSummary, type SheetView } from "./compact.js"
import { importsSheet, type Flattened } from "./compact-sheets.js"
import { formatCopperSummary } from "./copper-summary.js"
import { BOARD_SUMMARY_DESCRIPTION, formatBoardSummary } from "./board-summary.js"
import * as project from "./project-tools.js"
import { lockedNames } from "../studio/place-runner.js"
import * as copper from "./copper-tools.js"
import * as fillet from "./fillet-tools.js"
import * as pour from "./pour-tools.js"
import * as router from "./route-tools.js"
import * as placer from "./place-tools.js"
import { CREATE_PART_DESCRIPTION, createPartInput, createPartTool } from "./create-part.js"
import { IMPORT_PART_DESCRIPTION, importPart, importPartInput } from "./import-part.js"
import { MAKE_SHEET_DESCRIPTION, makeSheet, makeSheetInput } from "./make-sheet.js"
import { NEW_CIRCUIT_DESCRIPTION, newCircuit, newCircuitInput } from "./new-circuit.js"
import { fileURLToPath } from "node:url"
import { compactToolList } from "./compact-tool-list.js"
import { GUIDE_DESCRIPTION, guide, guideInput, skillResources } from "./guide.js"
import { ATTACH_DATASHEET_DESCRIPTION, attachDatasheetInput, attachDatasheetTool, checkDatasheetRule } from "./datasheet-tools.js"

const INSTRUCTIONS = `copperflow lets you design circuit boards (*.circuit.tsx files) together with a human, who edits the same files in the Studio.
- Call project_status first in every task, then follow the copperflow skill: its design workflow says which tool to call at each step and what its answer looks like.
- Change circuit files through these tools wherever one does the change: each call is one history entry the human can undo, and the tools enforce locks. Write code by hand only for what no tool writes.
- Never change, move or remove anything marked [LOCKED]; if a summary lists lock violations, restore those parts. "Marks from the human" are instructions; follow them. Do not redo a change the human undid.
- There is no tool to unlock a part or verify a library part: only the human does that.
- Without the copperflow skill installed, call guide (no topic) for it, then guide { topic } for a reference it names.`

const file = z.string().describe("Circuit file, e.g. index.circuit.tsx")
const literal = z.union([z.string(), z.number(), z.boolean()])
const READ_ONLY = { readOnlyHint: true, destructiveHint: false }

export interface ServerOptions {
  /** Builds the design for check_circuit, bom, export_package and export_fabrication; tests pass one that runs in this process. */
  engine?: DesignSource
  /** Fetches for import_part; tests pass one that answers from fixtures. */
  fetch?: typeof fetch
  /** Behind the hosted hub: create_part refuses a chip without a datasheet link, and import_part is not offered. */
  hosted?: boolean
}

export function createCopperflowServer(root: string, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: "copperflow", version: VERSION }, { instructions: INSTRUCTIONS })
  const designOptions = options.engine ? { engine: options.engine } : {}

  const apply = async (circuit: string, edits: Edit[], summary: string, note = summary, after: string[] = []) => {
    const result = await editCircuit(root, circuit, edits, { author: "ai", summary })
    const warnings = result.violations.map((v) => `Lock violation: ${v.part} ${v.kind}: ${v.detail}`)
    return [`Change ${result.entry.id} applied: ${note}`, ...after, ...warnings].join("\n")
  }
  const edit = (circuit: string, edits: Edit[], summary: string) => run(() => apply(circuit, edits, summary))

  server.registerTool(
    "list_circuits",
    { description: "List the circuit files (*.circuit.tsx) in the project.", annotations: READ_ONLY },
    () => run(async () => (await listCircuits(root)).join("\n") || "No circuit files found."),
  )

  server.registerTool(
    "circuit_summary",
    {
      description:
        'Summarize a circuit. The default is compact: one line per part (name, type, value, footprint, positions) and per net, then locked parts, marks from the human and lock violations; long lists end with "… and N more". A sub-sheet instance is one line followed by its parts. filter with an instance name (e.g. "PS1") shows only that instance, its parts and the nets they are on. detail "full" lists every prop and trace.',
      inputSchema: {
        file,
        detail: z.enum(["compact", "full"]).optional().describe('"compact" (default) or "full"'),
        filter: z.string().optional().describe('A sub-sheet instance, e.g. "PS1"'),
      },
      annotations: READ_ONLY,
    },
    ({ file: circuit, detail, filter }) =>
      run(async () => {
        const loaded = await loadCircuit(root, circuit)
        if (filter) return formatInstanceSummary(loaded, await flatDesign(root, loaded.file, options.engine), filter)
        if (detail === "full") return formatSummary(loaded)
        const usesSheets = loaded.model.imports.some((spec) => importsSheet(spec.source))
        return formatCompactSummary(loaded, usesSheets ? await sheetView(root, circuit, options.engine) : undefined)
      }),
  )

  server.registerTool(
    "set_props",
    {
      description:
        "Set literal props of a part, e.g. pcbX, pcbY, pcbRotation, schX, schY, resistance, footprint. Missing props are added. schNameAt and schValueAt move the part's name and value on the schematic, pcbNameAt its silkscreen designator: each is a point { x, y }, an offset from the part's origin (sheet units, board mm), which moves with the part. null removes one of these three props, which puts the label back where the layout puts it. noConnect: \"pin3,pin10\" flags pins meant to stay unconnected (no pin-unconnected error, a cross on the schematic); null removes the flags.",
      inputSchema: {
        file,
        part: z.string().describe("Part name, e.g. R1"),
        props: z
          .record(z.string(), z.union([literal, z.object({ x: z.number(), y: z.number() }), z.null()]))
          .describe("Props to set, e.g. { \"pcbX\": 4, \"resistance\": \"10k\", \"schNameAt\": { \"x\": 0, \"y\": 0.4 } }; null removes schNameAt, schValueAt or pcbNameAt"),
      },
    },
    ({ file: circuit, part, props }) => {
      const changes = Object.entries(props).map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      return edit(circuit, [{ kind: "setProps", part, props }], `set ${part} ${changes.join(" ")}`)
    },
  )

  server.registerTool(
    "remove_part",
    {
      description: "Remove a part and every trace connected to it.",
      inputSchema: { file, part: z.string() },
      annotations: { destructiveHint: true },
    },
    ({ file: circuit, part }) => edit(circuit, [{ kind: "removePart", part }], `remove ${part}`),
  )

  server.registerTool(
    "add_trace",
    {
      description: 'Connect two ports or nets, e.g. from ".R1 > .pin1" to "net.GND".',
      inputSchema: {
        file,
        from: z.string(),
        to: z.string(),
        props: z.record(z.string(), literal).optional().describe('Extra trace props, e.g. { "thickness": "0.4mm" }'),
      },
    },
    ({ file: circuit, from, to, props }) =>
      edit(circuit, [{ kind: "addTrace", from, to, ...(props ? { props } : {}) }], `add trace ${from} -> ${to}`),
  )

  server.registerTool(
    "remove_trace",
    {
      description: "Remove the trace between two selectors (in either direction).",
      inputSchema: { file, from: z.string(), to: z.string() },
      annotations: { destructiveHint: true },
    },
    ({ file: circuit, from, to }) => edit(circuit, [{ kind: "removeTrace", from, to }], `remove trace ${from} -> ${to}`),
  )

  server.registerTool(
    "check_circuit",
    {
      description:
        "Check the circuit with copperflow's own rules: electrical, placement, code and model, copper (clearance, width, vias, holes, board edge, keepouts) and pour findings. Answers with the error and warning counts, then up to 20 findings, one line each. Run it once at the end and fix the errors before reporting success; filter narrows it to errors, warnings, copper, a part or a net.",
      inputSchema: { file, filter: z.string().optional().describe('"errors", "warnings", "copper", a part name, a net name or a sub-sheet instance such as "PS1"') },
      annotations: READ_ONLY,
    },
    ({ file: circuit, filter }) =>
      run(async () => formatCompactCheck(circuit, await checkCircuit(root, circuit, designOptions), filter)),
  )

  const ports = { root, ...(options.engine ? { engine: options.engine } : {}), ...(options.hosted ? { hosted: true } : {}) }
  server.registerTool(
    "route_track",
    { description: copper.ROUTE_TRACK_DESCRIPTION, inputSchema: copper.routeTrackInput },
    (input) => run(() => copper.routeTrack(ports, input)),
  )
  server.registerTool("add_via", { description: copper.ADD_VIA_DESCRIPTION, inputSchema: copper.addViaInput }, (input) => run(() => copper.addVia(ports, input)))
  server.registerTool(
    "remove_copper",
    { description: copper.REMOVE_COPPER_DESCRIPTION, inputSchema: copper.removeCopperInput, annotations: { destructiveHint: true } },
    (input) => run(() => copper.removeCopper(ports, input)),
  )
  server.registerTool(
    "fillet_tracks",
    { description: fillet.FILLET_TRACKS_DESCRIPTION, inputSchema: fillet.filletTracksInput },
    (input) => run(() => fillet.filletTracks(ports, input)),
  )
  server.registerTool(
    "straighten_tracks",
    { description: fillet.STRAIGHTEN_TRACKS_DESCRIPTION, inputSchema: fillet.straightenTracksInput },
    (input) => run(() => fillet.straightenTracks(ports, input)),
  )
  server.registerTool("autoplace", { description: placer.AUTOPLACE_DESCRIPTION, inputSchema: placer.autoplaceInput }, (input) => run(() => placer.autoplace(ports, input)))
  server.registerTool("fit_board", { description: placer.FIT_BOARD_DESCRIPTION, inputSchema: placer.fitBoardInput }, (input) => run(() => placer.fitBoardTool(ports, input)))
  server.registerTool("autoroute", { description: router.AUTOROUTE_DESCRIPTION, inputSchema: router.autorouteInput }, (input) => run(() => router.autoroute(ports, input)))
  server.registerTool(
    "unroute",
    { description: router.UNROUTE_DESCRIPTION, inputSchema: router.unrouteInput, annotations: { destructiveHint: true } },
    (input) => run(() => router.unroute(ports, input)),
  )
  server.registerTool("add_pour", { description: pour.ADD_POUR_DESCRIPTION, inputSchema: pour.addPourInput }, (input) => run(() => pour.addPour(ports, input)))
  server.registerTool(
    "remove_pour",
    { description: pour.REMOVE_POUR_DESCRIPTION, inputSchema: pour.removePourInput, annotations: { destructiveHint: true } },
    (input) => run(() => pour.removePour(ports, input)),
  )
  server.registerTool("add_hole", { description: pour.ADD_HOLE_DESCRIPTION, inputSchema: pour.addHoleInput }, (input) => run(() => pour.addHole(ports, input)))
  server.registerTool(
    "remove_hole",
    { description: pour.REMOVE_HOLE_DESCRIPTION, inputSchema: pour.removeHoleInput, annotations: { destructiveHint: true } },
    (input) => run(() => pour.removeHole(ports, input)),
  )
  server.registerTool(
    "copper_summary",
    { description: copper.COPPER_SUMMARY_DESCRIPTION, inputSchema: { file }, annotations: READ_ONLY },
    ({ file: circuit }) => run(async () => formatCopperSummary(circuit, await copper.buildOf(ports, circuit))),
  )
  server.registerTool(
    "board_summary",
    {
      description: BOARD_SUMMARY_DESCRIPTION,
      inputSchema: { file, detail: z.enum(["compact", "full"]).optional().describe('"compact" (default, about 60 lines) or "full"') },
      annotations: READ_ONLY,
    },
    ({ file: circuit, detail }) =>
      run(async () => {
        const resolved = await resolveCircuit(root, circuit)
        const design = await copper.buildOf(ports, resolved.file)
        return formatBoardSummary(resolved.file, design, new Set(await lockedNames(resolved.path, design)), detail)
      }),
  )
  server.registerTool("project_status", { description: project.PROJECT_STATUS_DESCRIPTION, inputSchema: {}, annotations: READ_ONLY }, () => run(() => project.projectStatus(ports)))
  server.registerTool("note_decision", { description: project.NOTE_DECISION_DESCRIPTION, inputSchema: project.noteDecisionInput }, (input) => run(() => project.noteDecisionTool(ports, input)))
  server.registerTool("set_project", { description: project.SET_PROJECT_DESCRIPTION, inputSchema: project.setProjectInput }, (input) => run(() => project.setProjectTool(ports, input)))

  server.registerTool(
    "new_circuit",
    { description: NEW_CIRCUIT_DESCRIPTION, inputSchema: newCircuitInput },
    (input) => run(() => newCircuit(root, input, options.engine)),
  )

  server.registerTool("make_sheet", { description: MAKE_SHEET_DESCRIPTION, inputSchema: makeSheetInput }, (input) => run(() => makeSheet(root, input, options.engine)))

  server.registerTool(
    "edit_circuit",
    {
      description:
        "Apply several edits in order as ONE change (one history entry). Each edit has exactly one key: set_props { part, props }, connect { from, to }, disconnect { from, to }, place_part { part, name, props?, page? }, remove_part { part }, add_instance { sheet, name, connections, base?, page? } (another use of a sub-sheet), set_connections { instance, connections } (every port to its net), move_to_page { part, page } (a part or an instance; nets join across pages by name), add_pour { net, layer, outline?, props? }, remove_pour { id }, add_hole { x, y, diameter } or remove_hole { id }. If an edit is refused, nothing is written and the answer says which edit failed and why.",
      inputSchema: { file, edits: z.array(editItem).min(1).max(100) },
    },
    ({ file: circuit, edits }) =>
      run(async () => {
        const converted = []
        for (const [index, item] of edits.entries()) {
          try {
            converted.push(await toEdit(root, circuit, item))
          } catch (error) {
            throw new Error(describeRefusal({ index, reason: (error as Error).message }, edits.length, Object.keys(item)[0] ?? "edit"))
          }
        }
        const list = converted.map((c) => c.edit)
        const badNet = await unknownPourNet(root, circuit, list, options.engine)
        if (badNet) throw new Error(describeRefusal(badNet, edits.length, "add_pour"))
        const summary = batchSummary(converted.map((c) => c.label))
        const notes = list.some((e) => e.kind === "movePartToPage") ? await movesLeaveBehind(root, circuit, list) : []
        try {
          return await apply(circuit, list, summary, `${edits.length} edit${edits.length === 1 ? "" : "s"}: ${summary.slice(5)}`, notes)
        } catch (error) {
          const refusal = await firstRefusal(root, circuit, list)
          if (!refusal) throw new Error(`The batch was refused as a whole: ${(error as Error).message}
Nothing was written.`)
          throw new Error(describeRefusal(refusal, edits.length, Object.keys(edits[refusal.index] ?? {})[0] ?? "edit"))
        }
      }),
  )

  server.registerTool(
    "connect_nets",
    {
      description:
        'Connect pins to named nets in one change, e.g. { "GND": ["R1.pin2", "C1.pin2"], "V3_3": ["U1.VOUT"] }. Writes one connection per pin and skips pins already on that net.',
      inputSchema: { file, nets: z.record(z.string(), z.array(z.string()).min(1)) },
    },
    ({ file: circuit, nets }) =>
      run(async () => {
        const plan = await planNets(root, circuit, nets, options.engine)
        const counts = Object.entries(plan.added).map(([name, n]) => `${name} +${n}`).join(", ")
        if (plan.edits.length === 0) return `Nothing to do: all ${plan.skipped} pins are already on their nets.`
        const skipped = plan.skipped > 0 ? `; ${plan.skipped} already connected` : ""
        return apply(circuit, plan.edits, `connect nets ${counts}`, `connected ${plan.edits.length} pins (${counts}${skipped})`)
      }),
  )

  server.registerTool(
    "list_parts",
    { description: "List the parts library (parts/ in the project) with each part's verification status.", annotations: READ_ONLY },
    () =>
      run(async () => {
        const parts = await listParts(root)
        if (parts.length === 0) return "The parts library is empty. Create parts with create_part."
        return parts
          .map((p) => `${p.id}  <${p.component}>  ${p.title}  ${p.footprint}  ${p.verified ? "verified" : "NOT verified"}${p.origin ? `  ${p.origin}` : ""}`)
          .join("\n")
      }),
  )

  server.registerTool(
    "part_info",
    { description: "Show a library part's part.yaml and its verification checklist.", inputSchema: { id: z.string() }, annotations: READ_ONLY },
    ({ id }) =>
      run(async () => {
        const part = await readPart(root, id)
        const checklist = await readFile(join(partDir(root, id), "verification.md"), "utf8").catch(() => "(no verification.md)")
        return `${YAML.stringify(part)}\n--- verification.md ---\n${checklist}`
      }),
  )

  server.registerTool("create_part", { description: CREATE_PART_DESCRIPTION, inputSchema: createPartInput }, (input) =>
    run(async () => {
      if (options.hosted) checkDatasheetRule(input)
      return createPartTool(root, input)
    }),
  )
  server.registerTool("attach_datasheet", { description: ATTACH_DATASHEET_DESCRIPTION, inputSchema: attachDatasheetInput }, (input) => run(() => attachDatasheetTool(root, input)))
  server.registerTool("guide", { description: GUIDE_DESCRIPTION, inputSchema: guideInput, annotations: READ_ONLY }, (input) => run(() => guide(input)))
  for (const resource of skillResources()) {
    server.registerResource(resource.name, resource.uri, { mimeType: "text/markdown" }, async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: await readFile(fileURLToPath(resource.file), "utf8") }],
    }))
  }

  // The importer is off behind the hub (docs/licences.md: personal use on the person's own machine); there create_part
  // with a datasheet takes its place.
  if (!options.hosted) server.registerTool("import_part",{ description: IMPORT_PART_DESCRIPTION, inputSchema: importPartInput, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } }, (input) => run(() => importPart(root, input, options.fetch)))

  server.registerTool(
    "place_part",
    {
      description: `Add a part to a circuit: a library part id from list_parts (its import is added) or a built-in part: ${BUILTIN_PARTS.join(", ")}.`,
      inputSchema: {
        file,
        part: z.string(),
        name: z.string().describe("New designator, e.g. U2 or R5"),
        props: z.record(z.string(), literal).optional().describe('Literal props, e.g. { "resistance": "10k", "pcbX": 4 }'),
        page: z.string().optional().describe('Schematic page, e.g. "Power"; made when missing. Without one the part goes on the first page, "Main". Nets join across pages by name.'),
      },
    },
    ({ file: circuit, part, name, props, page }) =>
      run(async () => {
        const result = await placePart(root, circuit, { part, name, ...(props ? { props } : {}), ...(page ? { page } : {}) }, { author: "ai" })
        return `Change ${result.entry.id} applied: ${result.entry.summary}. Connect it with add_trace or connect_nets; run check_circuit once at the end.`
      }),
  )

  server.registerTool(
    "bom",
    {
      description: "Bill of materials for a circuit, grouped by part. It is read from the design the engine builds from the circuit code, so parts made in loops are counted.",
      inputSchema: { file },
      annotations: READ_ONLY,
    },
    ({ file: circuit }) => run(async () => formatBomMarkdown(await buildBom(root, circuit, designOptions))),
  )

  server.registerTool(
    "export_fabrication",
    {
      description:
        "Write the fabrication files for JLCPCB: Gerbers, plated and non-plated drills, pick-and-place and BOM in <name>-fab/ and <name>-fab.zip beside the circuit (or in the project folder out). Call it after autoroute and a clean check_circuit. A design with errors is refused and nothing is written; warnings are listed.",
      inputSchema: {
        file,
        out: z.string().optional().describe("A project folder to write into instead of the circuit's own, e.g. fab"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ file: circuit, out }) => {
      try {
        const result = await exportFabrication(root, circuit, { ...designOptions, ...(out ? { outDir: out } : {}) })
        return { ...(result.written ? {} : { isError: true }), content: [{ type: "text", text: formatFabrication(result, { compact: true }) }] }
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: (error as Error).message }] }
      }
    },
  )

  server.registerTool(
    "export_package",
    {
      description: "Write a folder with BOM.csv, BOM.md, the local datasheets and a list of library parts with their verification status.",
      inputSchema: { file },
    },
    ({ file: circuit }) =>
      run(async () => {
        const result = await exportPackage(root, circuit, designOptions)
        return `Wrote ${result.files.length} files to ${result.outDir}:\n${result.files.join("\n")}`
      }),
  )


  server.registerTool(
    "recent_changes",
    {
      description: "List recent changes by the agent and the human, newest first, including undos and redos.",
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
      annotations: READ_ONLY,
    },
    ({ limit }) => run(async () => {
      const { entries, problems } = await listHistory(root, limit ?? 20)
      return formatHistory(entries, problems)
    }),
  )

  server.registerTool(
    "undo_change",
    {
      description:
        'Undo one of your own changes: the newest one, or the given change id. When the human redoes an undone change, it comes back as the human\'s own "Redo:" entry, which you cannot undo.',
      inputSchema: { id: z.string().optional().describe("Change id such as c0003") },
    },
    ({ id }) =>
      run(async () => {
        // The built design tells which tracks start on locked parts, so copper can be undone while parts are locked.
        const design = (circuit: string) => buildWith(root, circuit, options.engine)
        const entry = await undoChange(root, { author: "ai", design, ...(id ? { id } : {}) })
        return `Change ${entry.id} applied: ${entry.summary}`
      }),
  )

  compactToolList(server)
  return server
}

/** What the moves to a page in a batch leave behind, read before anything is written. */
async function movesLeaveBehind(root: string, circuit: string, edits: Edit[]): Promise<string[]> {
  const loaded = await loadCircuit(root, circuit)
  return moveNotes(loaded.source, edits, new Set(loaded.annotations.locks.map((lock) => lock.part)))
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

async function run(task: () => Promise<string>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: await task() }] }
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: (error as Error).message }] }
  }
}
