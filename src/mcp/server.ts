import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { readFile } from "node:fs/promises"
import {
  bomWithReport,
  exportFabrication,
  exportPackage,
  formatFabrication,
  formatBomMarkdown,
  listParts,
  PartSchema,
  placePart,
  checkCircuit,
  editCircuit,
  formatHistory,
  formatSummary,
  listCircuits,
  listHistory,
  loadCircuit,
  resolveCircuit,
  redoChange,
  renameDesignators,
  undoChange,
  type Edit,
} from "../core/index.js"
import type { DesignSource } from "../core/bom.js"
import { buildWith } from "../core/design-source.js"
import { FootprintFileSchema } from "../engine/footprints/file.js"
import { VERSION } from "../version.js"
import { batchSummary, describeRefusal, editItem, firstRefusal, kindOf, moveNotes, planNets, toEdit, unknownPourNet } from "./batch.js"
import { formatCompactCheck, formatCompactSummary, formatInstanceSummary, type SheetView } from "./compact.js"
import { importsSheet, instanceAt, type Flattened } from "./compact-sheets.js"
import { readCard } from "../core/sheet-card.js"
import { DESCRIBE_SHEET_DESCRIPTION, describeSheetInput, describeSheetTool, instanceCard, withCard } from "./sheet-card-tools.js"
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
import { SIMULATE_DESCRIPTION, simulateInput } from "./simulate-tool.js"
import { simulate } from "../core/simulate.js"
import { IMPORT_PART_DESCRIPTION, importPart, importPartInput } from "./import-part.js"
import { IMPORT_BOARD_DESCRIPTION, importBoardInput, importBoardTool } from "./board-import-tool.js"
import { IMPORT_GRAPHIC_DESCRIPTION, importGraphicInput, importGraphicTool } from "./graphic-tool.js"
import { MAKE_SHEET_DESCRIPTION, makeSheet, makeSheetInput } from "./make-sheet.js"
import { NEW_CIRCUIT_DESCRIPTION, newCircuit, newCircuitInput } from "./new-circuit.js"
import { fileURLToPath } from "node:url"
import { compactToolList } from "./compact-tool-list.js"
import { createGuideMemory, GUIDE_DESCRIPTION, guideInSession, guideInput, skillResources } from "./guide.js"
import { ATTACH_DATASHEET_DESCRIPTION, attachDatasheetInput, attachDatasheetTool } from "./datasheet-tools.js"
import { RENDER_DESCRIPTION, renderInput, renderTool } from "./render-tool.js"
import { changeTarget, changeText, changeView } from "../core/change-view.js"
import { registerModuleTools } from "./module-tools.js"
import { EXPORT_MODEL_DESCRIPTION, exportModelInput, exportModelTool } from "./model-tool.js"
import { EXPORT_HTML_DESCRIPTION, exportHtmlInput, exportHtmlTool } from "./html-tool.js"
import { OPEN_STUDIO_DESCRIPTION, openStudio, openStudioInput } from "./open-studio.js"
import { BOARD_DESCRIPTION, boardInput, boardTool } from "./board-tool.js"
import { partInfo, SET_PART_FIELDS_DESCRIPTION, setPartFieldsInput, setPartFieldsTool } from "./part-tools.js"
import { SET_RULES_DESCRIPTION, setRulesInput, setRulesTool } from "./rules-tool.js"
import type { Renderer } from "../core/render.js"
import { renameMapping } from "./batch-steps.js"
import { ADD_TEXT_DESCRIPTION, addTextInput, textEdit } from "./text-tool.js"

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
const SHEET_FILE = /\.sheet\.tsx$/
const literal = z.union([z.string(), z.number(), z.boolean()])
const READ_ONLY = { readOnlyHint: true, destructiveHint: false }

export interface ServerOptions {
  /** Builds the design for check_circuit, bom, export_package and export_fabrication; tests pass one that runs in this process. */
  engine?: DesignSource
  /** Fetches for import_part; tests pass one that answers from fixtures. */
  fetch?: typeof fetch
  /** Loads the renderer for render; tests pass the source module. */
  renderer?: () => Promise<Renderer>
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

  server.registerTool(
    "list_circuits",
    { description: "List the circuit files (*.circuit.tsx) in the project.", annotations: READ_ONLY },
    () => run(async () => (await listCircuits(root)).join("\n") || "No circuit files found."),
  )

  server.registerTool(
    "circuit_summary",
    {
      description:
        'Summarize a circuit: one line per part and per net, then locked parts, marks from the human and lock violations. filter "PS1" shows one sub-sheet instance; detail "full" lists every prop and trace.',
      inputSchema: {
        file,
        detail: z.enum(["compact", "full"]).optional().describe('Default "compact"'),
        filter: z.string().optional().describe('A sub-sheet instance, e.g. "PS1"'),
      },
      annotations: READ_ONLY,
    },
    ({ file: circuit, detail, filter }) =>
      run(async () => {
        const loaded = await loadCircuit(root, circuit)
        if (filter) {
          const flat = await flatDesign(root, loaded.file, options.engine)
          const card = instanceCard(instanceAt(loaded.file, flat, filter))
          const described = card.does !== undefined || card.ports.some((port) => port.type || port.carries)
          return described ? withCard(formatInstanceSummary(loaded, flat, filter), card) : formatInstanceSummary(loaded, flat, filter)
        }
        const card = (text: string) => (SHEET_FILE.test(loaded.file) ? withCard(text, readCard(loaded.source)) : text)
        if (detail === "full") return card(formatSummary(loaded))
        const usesSheets = loaded.model.imports.some((spec) => importsSheet(spec.source))
        return card(formatCompactSummary(loaded, usesSheets ? await sheetView(root, circuit, options.engine) : undefined))
      }),
  )

  server.registerTool(
    "set_props",
    {
      description:
        "Set literal props of a part (pcbX, pcbY, pcbRotation, schX, resistance, footprint, …); missing props are added. schNameAt, schValueAt and pcbNameAt are label offsets { x, y }; noConnect: \"pin3,pin10\" flags pins meant to stay open; supplierPartNumbers: \"jlcpcb:C25804\". null removes these.",
      inputSchema: {
        file,
        part: z.string().describe("Part name, e.g. R1"),
        props: z
          .record(z.string(), z.union([literal, z.object({ x: z.number(), y: z.number() }), z.null()]))
          .describe('e.g. { "pcbX": 4, "resistance": "10k" }'),
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
      description: 'Schematic trace (a connection, no copper): connect two ports or nets, e.g. from ".R1 > .pin1" to "net.GND".',
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
      description: "Schematic trace (a connection, not copper): remove the one between two selectors (in either direction).",
      inputSchema: { file, from: z.string(), to: z.string() },
      annotations: { destructiveHint: true },
    },
    ({ file: circuit, from, to }) => edit(circuit, [{ kind: "removeTrace", from, to }], `remove trace ${from} -> ${to}`),
  )

  server.registerTool(
    "check_circuit",
    {
      description:
        "Check the circuit: electrical, placement, copper and pour rules. Answers with the error and warning counts, then up to 20 findings. Run it after autoplace, after autoroute and after removing copper; fix the errors before reporting success.",
      inputSchema: { file, filter: z.string().optional().describe('"errors", "warnings", "copper", a part, net, rule or instance') },
      annotations: READ_ONLY,
    },
    ({ file: circuit, filter }) =>
      run(async () => formatCompactCheck(circuit, await checkCircuit(root, circuit, designOptions), filter)),
  )

  const ports = { root, ...(options.engine ? { engine: options.engine } : {}) }
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
  server.registerTool("fit_board", { description: BOARD_DESCRIPTION, inputSchema: boardInput }, (input) => run(() => boardTool(ports, input)))
  server.registerTool("set_rules", { description: SET_RULES_DESCRIPTION, inputSchema: setRulesInput }, (input) => run(() => setRulesTool(ports, input)))
  server.registerTool("import_board", { description: IMPORT_BOARD_DESCRIPTION, inputSchema: importBoardInput }, (input) => run(() => importBoardTool(ports, input)))
  server.registerTool("import_graphic", { description: IMPORT_GRAPHIC_DESCRIPTION, inputSchema: importGraphicInput }, (input) => run(() => importGraphicTool(ports, input)))
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
  // Not read-only: out writes the picture into the project.
  server.registerTool("render", { description: RENDER_DESCRIPTION, inputSchema: renderInput, annotations: { readOnlyHint: false, destructiveHint: false } }, (input) =>
    renderTool({ ...ports, ...(options.renderer ? { renderer: options.renderer } : {}) }, input),
  )
  server.registerTool("project_status", { description: project.PROJECT_STATUS_DESCRIPTION, inputSchema: {}, annotations: READ_ONLY }, () => run(() => project.projectStatus(ports)))
  server.registerTool("note_decision", { description: project.NOTE_DECISION_DESCRIPTION, inputSchema: project.noteDecisionInput }, (input) => run(() => project.noteDecisionTool(ports, input)))
  server.registerTool("set_project", { description: project.SET_PROJECT_DESCRIPTION, inputSchema: project.setProjectInput }, (input) => run(() => project.setProjectTool(ports, input)))

  server.registerTool(
    "new_circuit",
    { description: NEW_CIRCUIT_DESCRIPTION, inputSchema: newCircuitInput },
    (input) => run(() => newCircuit(root, input, options.engine)),
  )

  server.registerTool("describe_sheet", { description: DESCRIBE_SHEET_DESCRIPTION, inputSchema: describeSheetInput }, (input) => run(() => describeSheetTool(root, input)))
  server.registerTool("simulate", { description: SIMULATE_DESCRIPTION, inputSchema: simulateInput, annotations: READ_ONLY }, (input) => run(() => simulate(root, input, options.engine)))
  server.registerTool("make_sheet", { description: MAKE_SHEET_DESCRIPTION, inputSchema: makeSheetInput }, (input) => run(() => makeSheet(root, input, options.engine)))

  server.registerTool(
    "edit_circuit",
    {
      description:
        'Apply several edits in order as ONE change, each with one key shaped like the tool of that name (connect also takes corners). add_drawing, set_drawing, remove_drawing, add_page, rename_page, remove_page, wire_corners, rename_parts, rename_port, sheet_size, set_pour, set_hole: guide { topic: "writing-circuits" }. One refused edit writes nothing; the answer names it.',
      inputSchema: { file, edits: z.array(editItem).min(1).max(100) },
    },
    ({ file: circuit, edits }) =>
      run(async () => {
        const rename = edits.findIndex((item) => item.rename_parts !== undefined)
        if (rename !== -1 && edits.length > 1) throw new Error(describeRefusal({ index: rename, reason: "rename_parts goes alone in its edit_circuit call; send the other edits in another" }, edits.length, "rename_parts"))
        if (rename !== -1) {
          try {
            kindOf(edits[0]!)
          } catch (error) {
            throw new Error(describeRefusal({ index: 0, reason: (error as Error).message }, 1, "rename_parts"))
          }
          return renameStep(circuit, edits[0]?.rename_parts)
        }
        const converted: Awaited<ReturnType<typeof toEdit>>[] = []
        for (const [index, item] of edits.entries()) {
          try {
            converted.push(await toEdit(root, circuit, item, converted.map((done) => done.edit)))
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
        'Connect pins to named nets as ONE change, e.g. { "GND": ["R1.pin2", "C1.pin2"] }; pins already on the net are skipped.',
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
    { description: 'List the parts library (parts/) with verification status. Built-in kinds (resistor, capacitor, led, pinheader, …) are not here: guide { topic: "writing-circuits" } lists them.', annotations: READ_ONLY },
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
    { description: "Show a library part's part.yaml, its footprint's pads and the verification checklist.", inputSchema: { id: z.string() }, annotations: READ_ONLY },
    ({ id }) => run(() => partInfo(root, id)),
  )

  server.registerTool("create_part", { description: CREATE_PART_DESCRIPTION, inputSchema: createPartInput }, (input) => run(() => createPartTool(root, input)))
  server.registerTool("set_part_fields", { description: SET_PART_FIELDS_DESCRIPTION, inputSchema: setPartFieldsInput }, (input) => run(() => setPartFieldsTool(root, input)))
  server.registerTool("attach_datasheet", { description: ATTACH_DATASHEET_DESCRIPTION, inputSchema: attachDatasheetInput }, (input) => run(() => attachDatasheetTool(root, input)))
  // One server is one MCP session (stdio: the process), so this memory is the session's.
  const guideSeen = createGuideMemory()
  server.registerTool("guide", { description: GUIDE_DESCRIPTION, inputSchema: guideInput, annotations: READ_ONLY }, (input) => run(() => guideInSession(guideSeen, input)))
  for (const resource of skillResources()) {
    server.registerResource(resource.name, resource.uri, { mimeType: "text/markdown" }, async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: await readFile(fileURLToPath(resource.file), "utf8") }],
    }))
  }

  server.registerTool("import_part", { description: IMPORT_PART_DESCRIPTION, inputSchema: importPartInput, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } }, (input) => run(() => importPart(root, input, options.fetch)))

  server.registerTool(
    "place_part",
    {
      description: 'Add a part to a circuit: a library part id from list_parts or a built-in kind (guide { topic: "writing-circuits" }).',
      inputSchema: {
        file,
        part: z.string(),
        name: z.string().describe("New designator, e.g. U2 or R5"),
        props: z.record(z.string(), literal).optional().describe('e.g. { "resistance": "10k" }'),
        page: z.string().optional().describe('Schematic page, made when missing; default "Main"'),
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
      description: "Bill of materials for a circuit, grouped by part, and whether the board is ready to order.",
      inputSchema: { file },
      annotations: READ_ONLY,
    },
    ({ file: circuit }) =>
      run(async () => {
        const { lines, report } = await bomWithReport(root, circuit, designOptions)
        return `${formatBomMarkdown(lines)}\n${report}`
      }),
  )

  server.registerTool(
    "export_fabrication",
    {
      description:
        "Write the JLCPCB fabrication files to <name>-fab/ and a zip: Gerbers, drills, pick-and-place and BOM CSVs, pictures of the board as made and a STEP model. Call it after a clean check_circuit: a design with errors is refused.",
      inputSchema: {
        file,
        out: z.string().optional().describe("Project folder to write into, e.g. fab"),
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

  server.registerTool("export_model", { description: EXPORT_MODEL_DESCRIPTION, inputSchema: exportModelInput, annotations: { readOnlyHint: false, destructiveHint: false } }, (input) =>
    run(() => exportModelTool({ root, ...designOptions, ...(options.renderer ? { renderer: options.renderer } : {}) }, input)),
  )

  server.registerTool("export_html", { description: EXPORT_HTML_DESCRIPTION, inputSchema: exportHtmlInput, annotations: { readOnlyHint: false, destructiveHint: false } }, (input) =>
    run(() => exportHtmlTool({ root, ...designOptions, ...(options.renderer ? { renderer: options.renderer } : {}) }, input)),
  )

  server.registerTool(
    "export_package",
    {
      description: "Write a folder with the BOM, local datasheets and the library parts' verification status.",
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
        'Undo one of your own changes: the newest, or the given id. A human\'s "Redo:" of it is theirs; you cannot undo it.',
      inputSchema: { id: z.string().optional().describe("e.g. c0003") },
    },
    ({ id }) =>
      run(async () => {
        // The built design tells which tracks start on locked parts, so copper can be undone while parts are locked.
        const design = (circuit: string) => buildWith(root, circuit, options.engine)
        const entry = await undoChange(root, { author: "ai", design, ...(id ? { id } : {}) })
        return `Change ${entry.id} applied: ${entry.summary}`
      }),
  )

  server.registerTool(
    "redo_change",
    { description: "Redo one of your own undos: the newest, or the given id (the undo's or the undone change's). A human's undo is theirs; you cannot redo it.", inputSchema: { id: z.string().optional() } },
    ({ id }) =>
      run(async () => {
        const design = (circuit: string) => buildWith(root, circuit, options.engine)
        const entry = await redoChange(root, { author: "ai", design, ...(id ? { id } : {}) })
        return `Change ${entry.id} applied: ${entry.summary}`
      }),
  )

  server.registerTool("add_text", { description: ADD_TEXT_DESCRIPTION, inputSchema: addTextInput }, (input) =>
    run(async () => {
      const { edit: one, label } = await textEdit(root, input)
      return apply(input.file, [one], label)
    }),
  )

  /** Renames designators as one change, the layout file's nets with them (Design → Annotate). */
  const renameStep = async (circuit: string, value: unknown) => {
    const mapping = renameMapping(value)
    const words = mapping.map(({ from, to }) => `${from} -> ${to}`).join(", ")
    const { entry } = await renameDesignators(root, circuit, mapping, { author: "ai", summary: `rename ${words}`.slice(0, 200), ...designOptions })
    return `Change ${entry.id} applied: renamed ${words}`
  }

  server.registerTool("open_studio", { description: OPEN_STUDIO_DESCRIPTION, inputSchema: openStudioInput, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }, (input) => run(() => openStudio({ root }, input)))
  registerModuleTools(server, root, run, options.engine)
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
