import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import {
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
import { VERSION } from "../version.js"

const INSTRUCTIONS = `copperflow lets you edit tscircuit circuit files together with a human.
- Call circuit_summary before changing a circuit, and again when the human says they changed something.
- Change existing parts and traces through these tools rather than rewriting the file, so locks and history apply.
- After moving or adding parts, call check_circuit and fix placement errors before reporting success.
- Never change, move or remove a part marked [LOCKED]. If a summary lists lock violations, restore those parts.
- "Marks from the human" are instructions placed on the board; follow them.
- recent_changes shows what the human undid; do not redo an undone change unless asked.`

const file = z.string().describe("Circuit file path relative to the project root, e.g. index.circuit.tsx")
const literal = z.union([z.string(), z.number(), z.boolean()])
const READ_ONLY = { readOnlyHint: true, destructiveHint: false }

export interface ServerOptions {
  /** The tscircuit CLI used by check_circuit; defaults to $COPPERFLOW_TSCI or `tsci`. */
  buildCommand?: string[]
}

export function createCopperflowServer(root: string, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: "copperflow", version: VERSION }, { instructions: INSTRUCTIONS })

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
