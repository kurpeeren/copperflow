// The shelf of modules for an agent: save a described sheet, list and read the shelf, and copy a module into a
// project. Verifying a module is a person's, at the terminal; no tool does it.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { buildWith, type DesignSource } from "../core/design-source.js"
import { allLibraryModules, isLibraryName, libraryModuleInfo, useLibraryModule } from "../core/library-modules.js"
import { listModules, moduleInfo, saveModule, useModule } from "../core/modules.js"

const READ_ONLY = { readOnlyHint: true, destructiveHint: false }

export function registerModuleTools(server: McpServer, root: string, run: (task: () => Promise<string>) => Promise<CallToolResult>, engine?: DesignSource): void {
  const errors = async (file: string) => {
    const design = await buildWith(root, file, engine)
    return design.diagnostics.filter((d) => d.severity === "error").map((d) => d.message)
  }
  server.registerTool(
    "save_module",
    {
      description: "Copy a described sheet and its library parts to the person's shelf of modules, after they approved the board. Refused without does or with a port that has no type and no carries (describe_sheet).",
      inputSchema: { file: z.string(), name: z.string().optional(), replace: z.boolean().optional() },
    },
    (input) => run(() => saveModule(root, input, errors)),
  )
  server.registerTool(
    "list_modules",
    { description: "The shelf, one line a module. Look here before designing a block.", inputSchema: { filter: z.string().optional() }, annotations: READ_ONLY },
    ({ filter }) => run(async () => listModules(filter, await allLibraryModules())),
  )
  server.registerTool(
    "module_info",
    { description: "A module's card, ports, parts, sources and origin.", inputSchema: { name: z.string() }, annotations: READ_ONLY },
    ({ name }) => run(() => (isLibraryName(name) ? libraryModuleInfo(name) : moduleInfo(name))),
  )
  server.registerTool(
    "use_module",
    { description: "Copy a module's sheet (and parts the project lacks) beside the circuit file; then add_instance.", inputSchema: { module: z.string(), file: z.string() } },
    (input) => run(() => (isLibraryName(input.module) ? useLibraryModule(root, input) : useModule(root, input))),
  )
}
