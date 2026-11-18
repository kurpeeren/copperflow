// File → Import a drawing (SVG or DXF)…: the answers a person gives after picking the file (the layer, the width) read
// into the request the server's /api/import-graphic takes, or why they cannot be. The drawing lands at the board's
// centre. Pure; plain TypeScript with .js imports, so the tests run it.

export const GRAPHIC_LAYERS = ["top-silkscreen", "bottom-silkscreen", "top-mask", "bottom-mask", "top", "bottom", "inner1", "inner2"] as const
export type GraphicLayerChoice = (typeof GRAPHIC_LAYERS)[number]

/** What the layer question shows, with the choices numbered so a person may type the number. */
export const LAYER_QUESTION = `Layer for the drawing: ${GRAPHIC_LAYERS.map((layer, i) => `${i + 1} ${layer}`).join(", ")}`
export const WIDTH_QUESTION = "Width in mm (the height follows the drawing's shape); leave empty for the drawing's own size"

export interface GraphicImportRequest {
  name: string
  text: string
  layer: GraphicLayerChoice
  width?: number
}

/** The request for the picked file and the answers; a message when an answer is not one it takes, undefined when cancelled. */
export function graphicImportRequest(picked: { name: string; text: string }, layerAnswer: string | null, widthAnswer: string | null): GraphicImportRequest | { message: string } | undefined {
  if (layerAnswer === null || widthAnswer === null) return undefined
  const typed = layerAnswer.trim()
  const layer = GRAPHIC_LAYERS[Number(typed) - 1] ?? GRAPHIC_LAYERS.find((one) => one === typed)
  if (!layer) return { message: `The layer must be one of ${GRAPHIC_LAYERS.join(", ")}` }
  if (widthAnswer.trim() === "") return { ...picked, layer }
  const width = Number(widthAnswer.trim())
  if (!Number.isFinite(width) || width <= 0) return { message: "The width must be a number of mm above 0" }
  return { ...picked, layer, width }
}
