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
import { createCopperflowServer } from "../mcp/server.js"

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

/** The two lines the hub adds to the hosted server's instructions. */
export function hubInstructions(hosted: string, publicOrigin: string): string {
  return `${hosted}
- Work in a project: list_projects, then open_project or new_project, before any tool but guide.
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
      instructions: hubInstructions(client.getInstructions() ?? "", publicOrigin),
      tools: [...PROJECT_TOOLS, ...hosted],
      forwarded: new Set(hosted.map((tool) => tool.name).filter((name) => name !== GUIDE_TOOL)),
    }
  } finally {
    await client.close()
    await server.close()
  }
}
