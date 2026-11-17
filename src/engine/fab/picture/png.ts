// The board picture as a PNG, encoded by the optional canvas package the other pictures use (loaded only when a
// picture is asked for), and the pictures the fabrication export adds: each side at 1600 px on its long side.
import { boardPicture, outlineBox, type BoardPicture, type PictureDesign, type Side } from "./board-picture.js"
import type { LookRequest } from "./looks.js"

/** What is used of the canvas package. */
export interface CanvasModule {
  createCanvas(width: number, height: number): {
    getContext(kind: "2d"): {
      createImageData(width: number, height: number): { data: Uint8ClampedArray }
      putImageData(image: { data: Uint8ClampedArray }, x: number, y: number): void
    }
    encode(format: "png"): Promise<Uint8Array>
  }
}

export type CanvasLoader = () => Promise<CanvasModule>

export const loadCanvas: CanvasLoader = () => import("@napi-rs/canvas") as unknown as Promise<CanvasModule>

/** Whether the error is the canvas package (or its native binary for this platform) not being found. */
export function canvasMissing(error: unknown): boolean {
  const { code, message } = error as { code?: unknown; message?: unknown }
  const text = typeof message === "string" ? message : ""
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") return text.includes("@napi-rs/canvas")
  return /native binding/i.test(text) && text.includes("@napi-rs/canvas")
}

export async function encodePng(picture: Pick<BoardPicture, "width" | "height" | "rgba">, canvas: CanvasLoader = loadCanvas): Promise<Uint8Array> {
  const { createCanvas } = await canvas()
  const surface = createCanvas(picture.width, picture.height)
  const ctx = surface.getContext("2d")
  const image = ctx.createImageData(picture.width, picture.height)
  image.data.set(picture.rgba)
  ctx.putImageData(image, 0, 0)
  return new Uint8Array(await surface.encode("png"))
}

/** The export's pictures' long side, in pixels. */
export const EXPORT_PICTURE_SIDE = 1600

/** Both sides at 1600 px on the long side, in the default look, as PNGs; undefined when the canvas package is missing. */
export async function exportPictures(design: PictureDesign, canvas: CanvasLoader = loadCanvas, look: LookRequest = {}): Promise<{ side: Side; png: Uint8Array }[] | undefined> {
  const box = outlineBox(design.pcb)
  const pxPerMm = EXPORT_PICTURE_SIDE / Math.max(box.maxX - box.minX, box.maxY - box.minY)
  let loaded: CanvasModule
  try {
    loaded = await canvas()
  } catch (error) {
    if (canvasMissing(error)) return undefined
    throw error
  }
  const pictures: { side: Side; png: Uint8Array }[] = []
  for (const side of ["top", "bottom"] as const) pictures.push({ side, png: await encodePng(boardPicture(design, { side, look, pxPerMm }), () => Promise.resolve(loaded)) })
  return pictures
}
