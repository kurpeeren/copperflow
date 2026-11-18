// A design as a GLB file in Node: the scene render's view "3d" draws (the board as made with its parts as simple
// shapes), written as a 3D model instead of drawn (look/glb.ts). Needs no canvas package.
import type { Design } from "../../../src/engine/design.js"
import { resolveLook, type LookRequest } from "../../../src/engine/fab/picture/looks.js"
import { designName } from "../../../src/engine/fab/names.js"
import { sceneGlb } from "../look/glb.js"
import { lookScene, partsWords, shapesWords } from "./look-render.js"
import { pngBytes } from "./png-bytes.js"

export interface ModelRequest {
  /** The board's mask, print and finish; a background means nothing to a model and is refused. */
  look?: LookRequest
}

export interface Model {
  glb: Uint8Array
  /** What the model shows and is not. */
  what: string
  parts: number
}

/** The design's GLB file and the words for it; a design with neither a board nor a part has nothing to write. */
export function modelGlb(design: Design, request: ModelRequest = {}): Model {
  const look = request.look ?? {}
  if (look.background !== undefined) throw new Error("a model has no background: that is for pictures")
  resolveLook(look)
  const { model, scene } = lookScene(design, look)
  if (scene.faces.length === 0) throw new Error("Nothing to write: the design has no board outline and no parts")
  const glb = sceneGlb(scene, { name: designName(design.file), names: model.parts.map((part) => part.name), png: pngBytes })
  return { glb, what: model.board ? shapesWords(model, look) : `${partsWords(model)} (no board outline)`, parts: model.parts.length }
}
