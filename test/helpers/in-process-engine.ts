import { resolveCircuit } from "../../src/core/workspace.js"
import { buildDesign } from "../../src/engine/design.js"
import { FOOTPRINT_FILE } from "../../src/engine/engine.js"
import { collectProjectFiles } from "../../src/engine/project-files.js"

/** Builds in this process, as the engine's worker does, so tests need no built worker file. */
export const inProcessEngine = {
  build: async (root: string, file: string) =>
    buildDesign(await collectProjectFiles(root, { include: FOOTPRINT_FILE }), (await resolveCircuit(root, file)).file),
}
