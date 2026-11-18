import { resolveCircuit } from "../../src/core/workspace.js"
import { buildDesign } from "../../src/engine/design.js"
import { FOOTPRINT_FILE, GRAPHIC_FILES } from "../../src/engine/engine.js"
import { collectProjectFiles } from "../../src/engine/project-files.js"

/** The footprint files and the drawings a build reads (the rules file is left to each test). */
const READ = new RegExp(`${FOOTPRINT_FILE.source}|${GRAPHIC_FILES.source}`)

/** Builds in this process, as the engine's worker does, so tests need no built worker file. */
export const inProcessEngine = {
  build: async (root: string, file: string) =>
    buildDesign(await collectProjectFiles(root, { include: READ }), (await resolveCircuit(root, file)).file),
  buildFiles: async (files: Record<string, string>, main: string) => buildDesign(files, main),
}
