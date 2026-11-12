// What the hub's MCP server offers: the hosted server's instructions and tool list, taken once at start, plus the three
// project tools the hub answers itself. The hosted list is read by connecting an MCP client in memory to a hosted
// server made for a folder that does not exist and asking tools/list: registering tools and listing them only
// serialises their schemas, so no circuit code runs and no file is read (tests check the folder is never made).
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import { createCopperflowServer, INSTRUCTIONS_INTRO, INSTRUCTIONS_RULES } from "../mcp/server.js"

export const HUB_TOOLS = ["list_projects", "new_project", "open_project"] as const
/** Answered by the hub itself from the skill files, so an agent can learn before any project exists. */
export const GUIDE_TOOL = "guide"

const PROJECT_TOOLS: Tool[] = [
  {
    name: "list_projects",
    description: "Your projects: name, id, circuit and part counts, and which is open.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "new_project",
    description: "Create a project and open it.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "1 to 100 characters" } }, required: ["name"] },
  },
  {
    name: "open_project",
    description: "Open one of your projects by name or id.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, id: { type: "string" } } },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
]

export interface Catalog {
  instructions: string
  /** The project tools first, then every hosted tool, as tools/list answers. */
  tools: Tool[]
  /** The hosted tools the hub forwards to the open project's workspace (all but guide). */
  forwarded: ReadonlySet<string>
}

/**
 * What a client of the hub reads: the workspace's rules with ONE start order in place of the workspace's own (which
 * starts at project_status, a tool that needs an open project).
 */
export function hubInstructions(publicOrigin: string): string {
  return `${INSTRUCTIONS_INTRO}
- Start in this order: open or create a project (list_projects, then open_project or new_project; no workspace tool works before), then project_status, then guide (no topic) once, which is the copperflow skill. Follow its design workflow; call guide { topic } only for a reference it names.
${INSTRUCTIONS_RULES}
- The person watches the open project at ${publicOrigin}/p/<project id>/.`
}

/** Reads the hosted server's instructions and tool list once (see the top of this file). */
export async function loadCatalog(publicOrigin: string): Promise<Catalog> {
  const nowhere = join(tmpdir(), `copperflow-hub-catalog-${randomBytes(8).toString("hex")}`)
  const server = createCopperflowServer(nowhere, { hosted: true })
  const client = new Client({ name: "copperflow-hub", version: "0" })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  try {
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
    const { tools } = await client.listTools()
    const hosted = tools.filter((tool) => !(HUB_TOOLS as readonly string[]).includes(tool.name))
    return {
      instructions: hubInstructions(publicOrigin),
      tools: [...PROJECT_TOOLS, ...hosted],
      forwarded: new Set(hosted.map((tool) => tool.name).filter((name) => name !== GUIDE_TOOL)),
    }
  } finally {
    await client.close()
    await server.close()
  }
}
