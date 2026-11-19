// The parts' faces for the STEP file, as the 3D view draws them (look/parts): each part's faces in the model's order
// of parts, with their colours, for src/engine/solid/step.ts. The CLI and the MCP server reach it through the bundle
// dist/render/render.js, as they reach the pictures. Pure; needs no canvas package.
import type { Design } from "../../../src/engine/design.js"
import type { SolidModel } from "../../../src/engine/solid/model.js"
import type { PartFaces, StepFace } from "../../../src/engine/solid/step-faces.js"
import { partFaces } from "../look/parts/index.js"

/** Every part's faces, one list per part of `model` (the design's solid model), in its order. */
export function stepPartFaces(design: Design, model: SolidModel): PartFaces {
  const grouped: StepFace[][] = model.parts.map(() => [])
  for (const face of partFaces(design, model)) grouped[face.part]?.push({ loops: face.loops, normal: face.normal, color: face.color, alpha: face.alpha })
  return grouped
}
