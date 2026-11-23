// export { as: "html" }: the design as one web page with its pictures, BOM and files inside, to hand to a person.
import type { DesignSource } from "../core/design-source.js"
import { exportHtml, formatHtmlExport } from "../core/html-export.js"
import type { Renderer } from "../core/render.js"
import type { LookRequest } from "../engine/fab/picture/looks.js"
import { stepsAroundBuild } from "./build-steps.js"
import { QUIET, type Reporter } from "./tool-activity.js"

export interface HtmlPorts {
  root: string
  engine?: DesignSource
  renderer?: () => Promise<Renderer>
  /** The day the page names; today when left out. */
  date?: Date
  /** Hears the steps: the build, then the drawing and packing. */
  report?: Reporter
}

type HtmlInput = { file: string; out?: string | undefined; look?: Record<string, string | undefined> | undefined }

/** Writes the page and answers the lines the CLI's html command prints. */
export async function exportHtmlTool(ports: HtmlPorts, input: HtmlInput): Promise<string> {
  const engine = stepsAroundBuild(ports.engine, ports.report ?? QUIET, "Drawing the schematic, the board and the 3D views, and packing the files")
  const options = {
    ...(engine ? { engine } : {}),
    ...(ports.renderer ? { renderer: ports.renderer } : {}),
    ...(ports.date ? { date: ports.date } : {}),
    ...(input.out !== undefined ? { out: input.out } : {}),
    ...(input.look !== undefined ? { look: input.look as LookRequest } : {}),
  }
  return formatHtmlExport(await exportHtml(ports.root, input.file, options))
}
