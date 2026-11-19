// The parts' shapes for a STEP file: the faces the 3D view draws each part with, made by the Studio's renderer bundled
// to dist/render/render.js (studio/src/render/step-faces.ts), as the pictures are. The engine does not import the
// Studio's code, so the exports that write a STEP file load the faces here and hand them on as data. When the bundle
// cannot be loaded or cannot shape the parts, the parts are boxes and the answer says why instead of failing.
import type { Design } from "../engine/design.js"
import type { SolidModel } from "../engine/solid/model.js"
import type { PartShapes } from "../engine/solid/step-faces.js"

/** Loads the module that shapes the parts: the renderer bundle, or in tests its source. */
export type ShapesLoader = () => Promise<object>

/** The bundle sits beside dist/core: dist/render/render.js. Its path is built at run time, so tsc leaves it alone. */
const bundledShapes: ShapesLoader = () => import(new URL("../render/render.js", import.meta.url).href) as Promise<object>

const BUNDLE_MISSING = "the renderer bundle dist/render/render.js is missing; npm run build makes it"
const NO_SHAPER = "the renderer bundle has no part shapes; rebuild it with npm run build"
const WRONG_COUNT = "the renderer shaped a different number of parts than the model holds"

type Shaper = (design: Design, model: SolidModel) => unknown

/** Why loading or shaping failed, in a few plain words. */
function reason(error: unknown): string {
  const { code } = error as { code?: unknown }
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") return BUNDLE_MISSING
  const message = error instanceof Error ? error.message : String(error)
  return message.split("\n")[0] ?? message
}

/** The faces of every part of `model` (the design's solid model), or why there are none. A model without parts needs none. */
export async function loadPartShapes(design: Design, model: SolidModel, loader: ShapesLoader = bundledShapes): Promise<PartShapes> {
  if (model.parts.length === 0) return {}
  try {
    const shaper = ((await loader()) as { stepPartFaces?: unknown }).stepPartFaces
    if (typeof shaper !== "function") return { missing: NO_SHAPER }
    const faces = (shaper as Shaper)(design, model)
    if (!Array.isArray(faces) || faces.length !== model.parts.length) return { missing: WRONG_COUNT }
    return { faces }
  } catch (error) {
    return { missing: reason(error) }
  }
}
