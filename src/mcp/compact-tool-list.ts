// The tool list as clients receive it, without the JSON Schema plumbing zod adds and no agent reads: every client pays
// for the whole tools/list answer when it connects. The tools still check every argument with their zod schemas, and a
// refused argument is answered with the reason, so nothing an agent needs is lost.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

/** Keys dropped wherever they appear in a schema: the validation detail the server enforces anyway. */
const DROPPED_KEYS = new Set(["$schema", "pattern", "maxLength", "minLength", "maxItems", "format", "additionalItems"])

const isUnbounded = (key: string, value: unknown) =>
  ((key === "maximum" || key === "minimum") && typeof value === "number" && Math.abs(value) === Number.MAX_SAFE_INTEGER) ||
  (key === "additionalProperties" && value === false)
const isPlainStringKeys = (key: string, value: unknown) =>
  key === "propertyNames" && typeof value === "object" && value !== null && Object.keys(value).length === 1 && (value as { type?: unknown }).type === "string"

/** A schema without the dropped keys, unbounded integer limits and `propertyNames: { type: "string" }`. */
export function compactSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactSchema)
  if (typeof value !== "object" || value === null) return value
  const entries = Object.entries(value).filter(([key, child]) => !DROPPED_KEYS.has(key) && !isUnbounded(key, child) && !isPlainStringKeys(key, child))
  return Object.fromEntries(entries.map(([key, child]) => [key, compactSchema(child)]))
}

interface ToolEntry {
  inputSchema?: unknown
  execution?: { taskSupport?: string }
  [key: string]: unknown
}

/** One tool without the plumbing; `execution` goes when it only says tasks are not supported (the default). */
function compactTool(tool: ToolEntry): ToolEntry {
  const { execution, inputSchema, ...rest } = tool
  const keepExecution = execution !== undefined && execution.taskSupport !== "forbidden"
  return { ...rest, ...(inputSchema === undefined ? {} : { inputSchema: compactSchema(inputSchema) }), ...(keepExecution ? { execution } : {}) }
}

type Handler = (request: unknown, extra: unknown) => unknown
interface WithHandlers {
  _requestHandlers: Map<string, Handler>
}

/** Wraps the server's tools/list answer; call it after every tool is registered. */
export function compactToolList(server: McpServer): void {
  const handlers = (server.server as unknown as WithHandlers)._requestHandlers
  const original = handlers.get("tools/list")
  if (original === undefined) throw new Error("compactToolList: register the tools first")
  server.server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const answer = (await original(request, extra)) as { tools: ToolEntry[] }
    return { ...answer, tools: answer.tools.map(compactTool) } as never
  })
}
