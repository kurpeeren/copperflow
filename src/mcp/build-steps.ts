// The steps of a tool whose work happens inside one core call (the exports, the render): the core builds the board
// first, then draws and writes. Wrapping the design source tells the step after the build when it begins, without a
// hook in the core.
import type { DesignSource } from "../core/design-source.js"
import { buildWith } from "../core/design-source.js"
import type { Reporter } from "./tool-activity.js"

/** The step told while the board is built. */
export const BUILDING_STEP = "Building the board"

/**
 * Tells `BUILDING_STEP` now and `next` once a build finishes, through a source that builds as `engine` does (a new
 * engine per build when there is none, as buildWith does). Nobody listening: `engine` itself, untouched.
 */
export function stepsAroundBuild(engine: DesignSource | undefined, report: Reporter, next: string): DesignSource | undefined {
  if (!report.heard) return engine
  report.step(BUILDING_STEP)
  return {
    build: async (root, file) => {
      const design = await buildWith(root, file, engine)
      report.step(next)
      return design
    },
    ...(engine?.buildFiles ? { buildFiles: engine.buildFiles.bind(engine) } : {}),
  }
}
