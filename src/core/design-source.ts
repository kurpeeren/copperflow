import type { Design } from "../engine/design.js"
import { Engine } from "../engine/engine.js"

/** What the BOM and the check need from an engine: it builds one circuit file into a design. */
export type DesignSource = Pick<Engine, "build">

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
