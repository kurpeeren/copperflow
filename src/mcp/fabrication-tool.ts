// export { as: "fabrication" }: the JLCPCB files written through the core, its steps told while it works.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { DesignSource } from "../core/design-source.js"
import type { ShapesLoader } from "../core/part-shapes.js"
import { exportFabrication, formatFabrication } from "../core/index.js"
import { stepsAroundBuild } from "./build-steps.js"
import { QUIET, type Reporter } from "./tool-activity.js"

export interface FabricationPorts {
  root: string
  engine?: DesignSource
  report?: Reporter
  /** Loads the renderer that shapes the STEP model's parts; tests pass its source. The bundle when left out. */
  renderer?: ShapesLoader
}

/** The files written, or why not, as the answer; a refused design is an error answer. */
export async function exportFabricationTool(ports: FabricationPorts, input: { file: string; out?: string | undefined }): Promise<CallToolResult> {
  try {
    const engine = stepsAroundBuild(ports.engine, ports.report ?? QUIET, "Writing the Gerbers, drills, pictures and STEP model")
    const result = await exportFabrication(ports.root, input.file, { ...(engine ? { engine } : {}), ...(input.out ? { outDir: input.out } : {}), ...(ports.renderer ? { shapes: ports.renderer } : {}) })
    return { ...(result.written ? {} : { isError: true }), content: [{ type: "text", text: formatFabrication(result, { compact: true }) }] }
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: (error as Error).message }] }
  }
}
