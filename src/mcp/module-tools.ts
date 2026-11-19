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
      description: "Copy a described sheet and its library parts to the person's shelf of modules, only after they approved the board. Refused without does or with a port that has no type and no carries: run describe_sheet first.",
      inputSchema: {
        file: z.string().describe("The sheet, <Name>.sheet.tsx"),
        name: z.string().optional().describe("Default the sheet's name"),
        replace: z.boolean().optional().describe("Overwrite a module of that name"),
      },
    },
    (input) => run(() => saveModule(root, input, errors)),
  )
  server.registerTool(
    "list_modules",
    {
      description: "List the modules: the person's shelf, then each library's (named library/Name), one line each. Look here before designing a block; module_info reads one.",
      inputSchema: { filter: z.string().optional().describe("Words to narrow the list") },
      annotations: READ_ONLY,
    },
    ({ filter }) => run(async () => listModules(filter, await allLibraryModules())),
  )
  server.registerTool(
    "module_info",
    {
      description: "Read one module before using it: what it does, each port's type and what it carries, its parts, sources and origin. An unknown name is refused; use_module copies it.",
      inputSchema: { name: z.string().describe("As list_modules shows it: Name or library/Name") },
      annotations: READ_ONLY,
    },
    ({ name }) => run(() => (isLibraryName(name) ? libraryModuleInfo(name) : moduleInfo(name))),
  )
  server.registerTool(
    "use_module",
    {
      description: "Copy a module's sheet (and parts the project lacks) beside the circuit file; the answer gives the add_instance step to run next. A library's sheet must be plain; its parts come as data.",
      inputSchema: { module: z.string().describe("As list_modules shows it"), file: z.string().describe("The circuit it goes into") },
    },
    (input) => run(() => (isLibraryName(input.module) ? useLibraryModule(root, input) : useModule(root, input))),
  )
}
