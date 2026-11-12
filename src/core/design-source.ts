import type { Design } from "../engine/design.js"
import { Engine } from "../engine/engine.js"

/** What the BOM and the check need from an engine: it builds one circuit file into a design. */
export type DesignSource = Pick<Engine, "build"> & Partial<Pick<Engine, "buildFiles">>

/**
 * Builds a circuit from files held in memory in an engine worker: the given engine's, or a new engine stopped
 * afterwards. Hosted mode uses it so that no circuit code runs in the server's main thread.
 */
export async function buildFilesWith(files: Record<string, string>, main: string, engine?: DesignSource): Promise<Design> {
  if (engine?.buildFiles) return engine.buildFiles(files, main)
  const own = new Engine()
  try {
    return await own.buildFiles(files, main)
  } finally {
    await own.stop()
  }
}

/** Builds `file` with the given engine, or with a new engine that is stopped afterwards. */
export async function buildWith(root: string, file: string, engine?: DesignSource): Promise<Design> {
  if (engine) return engine.build(root, file)
  const own = new Engine()
  try {
    return await own.build(root, file)
  } finally {
    await own.stop()
  }
}
