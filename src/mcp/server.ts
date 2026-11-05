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
  formatCheck,
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

const INSTRUCTIONS = `copperflow lets you edit tscircuit circuit files together with a human.
- Call circuit_summary before changing a circuit, and again when the human says they changed something.
- Change existing parts and traces through these tools rather than rewriting the file, so locks and history apply.
- After moving or adding parts, call check_circuit and fix placement errors before reporting success.
- Never change, move or remove a part marked [LOCKED]. If a summary lists lock violations, restore those parts.
- "Marks from the human" are instructions placed on the board; follow them.
- recent_changes shows what the human undid; do not redo an undone change unless asked.
- New chips go into the parts library first (create_part from the datasheet), then into the circuit with place_part.
  Library parts start NOT verified; only the human verifies them.`

const file = z.string().describe("Circuit file path relative to the project root, e.g. index.circuit.tsx")
const literal = z.union([z.string(), z.number(), z.boolean()])
const READ_ONLY = { readOnlyHint: true, destructiveHint: false }

export interface ServerOptions {
  /** The tscircuit CLI used by check_circuit; defaults to $COPPERFLOW_TSCI or `tsci`. */
  buildCommand?: string[]
  /** Builds the design for bom and export_package; tests pass one that runs in this process. */
  engine?: DesignSource
}

export function createCopperflowServer(root: string, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: "copperflow", version: VERSION }, { instructions: INSTRUCTIONS })
  const designOptions = options.engine ? { engine: options.engine } : {}

  const edit = (circuit: string, edits: Edit[], summary: string) =>
    run(async () => {
      const result = await editCircuit(root, circuit, edits, { author: "ai", summary })
      const warnings = result.violations.map((v) => `Lock violation: ${v.part} ${v.kind}: ${v.detail}`)
      return [`Change ${result.entry.id} applied: ${summary}`, ...warnings].join("\n")
    })

  server.registerTool(
    "list_circuits",
    { description: "List the circuit files (*.circuit.tsx) in the project.", annotations: READ_ONLY },
    () => run(async () => (await listCircuits(root)).join("\n") || "No circuit files found."),
  )

  server.registerTool(
    "circuit_summary",
    {
      description:
        "Summarize a circuit: parts with their props, traces, locked parts, read-only parts, marks left by the human and lock violations.",
      inputSchema: { file },
      annotations: READ_ONLY,
    },
    ({ file: circuit }) => run(async () => formatSummary(await loadCircuit(root, circuit))),
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
        "Build the circuit with the tscircuit CLI and report its errors and warnings: courtyard overlaps, unrouted ports, missing parts. Run it after every placement change; it can take a minute.",
      inputSchema: { file },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ file: circuit }) =>
      run(async () => {
        const result = await checkCircuit(root, circuit, options.buildCommand ? { command: options.buildCommand } : {})
        return formatCheck(circuit, result)
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
        return `Change ${result.entry.id} applied: ${result.entry.summary}. Connect it with add_trace, then run check_circuit.`
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
      description: "List recent changes by the agent and the human, newest first, including undos.",
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
      annotations: READ_ONLY,
    },
    ({ limit }) => run(async () => formatHistory(await listEntries(root, limit ?? 20))),
  )

  server.registerTool(
    "undo_change",
    {
      description: "Undo one of your own changes: the newest one, or the given change id.",
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
