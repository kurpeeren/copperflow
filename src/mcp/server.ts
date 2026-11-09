import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import YAML from "yaml"
import {
  BUILTIN_PARTS,
  buildBom,
  createPart,
  exportPackage,
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
  listEntries,
  loadCircuit,
  undoChange,
  type Edit,
} from "../core/index.js"
import type { DesignSource } from "../core/bom.js"
import { FootprintFileSchema } from "../engine/footprints/file.js"
import { VERSION } from "../version.js"
import { batchSummary, describeRefusal, editItem, firstRefusal, planNets, toEdit } from "./batch.js"
import { formatCompactCheck, formatCompactSummary } from "./compact.js"

const INSTRUCTIONS = `copperflow lets you edit circuit files together with a human.
- Write parts and connections, not positions or wire corners. The program places the parts and routes the wires; leave schX, schY, pcbX, pcbY and schematicRouteHints alone unless the human asks for a position.
- Call circuit_summary before changing a circuit, and again when the human says they changed something. The default answer is compact (one line per part and per net); use detail "full" only when you need every prop.
- Make several changes in one call: edit_circuit takes a list of edits (one history entry, nothing written if one is refused), connect_nets wires whole nets at once, e.g. { "GND": ["R1.pin2", "C1.pin2"] }.
- Change existing parts and traces through these tools rather than rewriting the file, so locks and history apply.
- Call check_circuit once at the end, then fix every error before reporting success. It shows the first 20 findings; use its filter (errors, warnings, a part or a net) for the rest.
- Never change, move or remove a part marked [LOCKED]. If a summary lists lock violations, restore those parts.
- "Marks from the human" are instructions placed on the board; follow them.
- recent_changes shows what the human undid; do not redo an undone change unless asked.
- New chips go into the parts library first (create_part from the datasheet), then into the circuit with place_part.
  Library parts start NOT verified; only the human verifies them.`

const file = z.string().describe("Circuit file path relative to the project root, e.g. index.circuit.tsx")
const literal = z.union([z.string(), z.number(), z.boolean()])
const READ_ONLY = { readOnlyHint: true, destructiveHint: false }

export interface ServerOptions {
  /** Builds the design for check_circuit, bom and export_package; tests pass one that runs in this process. */
  engine?: DesignSource
}

export function createCopperflowServer(root: string, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: "copperflow", version: VERSION }, { instructions: INSTRUCTIONS })
  const designOptions = options.engine ? { engine: options.engine } : {}

  const apply = async (circuit: string, edits: Edit[], summary: string, note = summary) => {
    const result = await editCircuit(root, circuit, edits, { author: "ai", summary })
    const warnings = result.violations.map((v) => `Lock violation: ${v.part} ${v.kind}: ${v.detail}`)
    return [`Change ${result.entry.id} applied: ${note}`, ...warnings].join("\n")
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
        'Summarize a circuit. The default is compact: one line per part (name, type, value, footprint, positions) and per net, then locked parts, marks from the human and lock violations; long lists end with "… and N more". detail "full" lists every prop and trace.',
      inputSchema: { file, detail: z.enum(["compact", "full"]).optional().describe('"compact" (default) or "full"') },
      annotations: READ_ONLY,
    },
    ({ file: circuit, detail }) =>
      run(async () => {
        const loaded = await loadCircuit(root, circuit)
        return detail === "full" ? formatSummary(loaded) : formatCompactSummary(loaded)
      }),
  )

  server.registerTool(
    "set_props",
    {
      description:
        "Set literal props of a part, e.g. pcbX, pcbY, pcbRotation, schX, schY, resistance, footprint. Missing props are added.",
      inputSchema: {
        file,
        part: z.string().describe("Part name, e.g. R1"),
        props: z.record(z.string(), literal).describe("Props to set, e.g. { \"pcbX\": 4, \"resistance\": \"10k\" }"),
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
        "Check the circuit with copperflow's own rules: electrical checks (pins left unconnected, outputs shorted together, power pins without a source) and placement checks (overlapping parts, parts off the board), plus problems in the code and the model (footprints it cannot make, unknown or ambiguous pins, library overrides). Answers with the error and warning counts, then up to 20 findings, one line each. Run it once at the end and fix the errors before reporting success; filter narrows it to errors, warnings, a part or a net.",
      inputSchema: { file, filter: z.string().optional().describe('"errors", "warnings", a part name or a net name') },
      annotations: READ_ONLY,
    },
    ({ file: circuit, filter }) =>
      run(async () => formatCompactCheck(circuit, await checkCircuit(root, circuit, designOptions), filter)),
  )

  server.registerTool(
    "edit_circuit",
    {
      description:
        "Apply several edits in order as ONE change (one history entry). Each edit has exactly one key: set_props { part, props }, connect { from, to }, disconnect { from, to }, place_part { part, name, props? } or remove_part { part }. If an edit is refused, nothing is written and the answer says which edit failed and why.",
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
        const summary = batchSummary(converted.map((c) => c.label))
        try {
          return await apply(circuit, list, summary, `${edits.length} edit${edits.length === 1 ? "" : "s"}: ${summary.slice(5)}`)
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
          .map((p) => `${p.id}  <${p.component}>  ${p.title}  ${p.footprint}  ${p.verified ? "verified" : "NOT verified"}`)
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

  server.registerTool(
    "create_part",
    {
      description:
        "Create a library part from a datasheet you have read: pins by number with names and electrical types, a copperflow footprint string such as sot23_5 or 0402, MPN and supplier numbers. When no footprint string fits the package, set footprint to \"footprint.yaml\" and pass footprint_file with every pad transcribed from the datasheet's recommended land pattern (never estimate). The part starts NOT verified; tell the human to check verification.md.",
      inputSchema: {
        id: z.string().describe("Folder name, e.g. AP2112K-3.3"),
        part: PartSchema.omit({ verified: true }),
        footprint_file: FootprintFileSchema.optional().describe(
          'Pads in mm (y up, origin at the part centre) from the datasheet land pattern; requires part.footprint to be "footprint.yaml"',
        ),
        replace: z.boolean().optional().describe("Overwrite an existing, unverified part"),
      },
    },
    ({ id, part, footprint_file, replace }) =>
      run(async () => {
        const result = await createPart(root, id, part, {
          replace: replace === true,
          ...(footprint_file ? { footprintFile: footprint_file } : {}),
          now: new Date().toISOString(),
        })
        return [
          `Created ${result.files.join(", ")}.`,
          `Use it with place_part (part "${id}"). It is NOT verified: ask the human to check parts/${id}/verification.md against the datasheet.`,
        ].join("\n")
      }),
  )

  server.registerTool(
    "place_part",
    {
      description: `Add a part to a circuit: a library part id from list_parts (its import is added) or a built-in part: ${BUILTIN_PARTS.join(", ")}.`,
      inputSchema: {
        file,
        part: z.string(),
        name: z.string().describe("New designator, e.g. U2 or R5"),
        props: z.record(z.string(), literal).optional().describe('Literal props, e.g. { "resistance": "10k", "pcbX": 4 }'),
      },
    },
    ({ file: circuit, part, name, props }) =>
      run(async () => {
        const result = await placePart(root, circuit, { part, name, ...(props ? { props } : {}) }, { author: "ai" })
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
    ({ limit }) => run(async () => formatHistory(await listEntries(root, limit ?? 20))),
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
        const entry = await undoChange(root, { author: "ai", ...(id ? { id } : {}) })
        return `Change ${entry.id} applied: ${entry.summary}`
      }),
  )

  return server
}

async function run(task: () => Promise<string>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: await task() }] }
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: (error as Error).message }] }
  }
}
