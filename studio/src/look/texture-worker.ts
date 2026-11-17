// Makes the board's two pictures for the 3D view off the page's thread: they take about a second, and the page must
// stay usable while they are made. Answers the textures, their pixels handed over rather than copied.
import { boardTextures } from "./texture.js"

self.onmessage = (event: MessageEvent) => {
  const { id, design, model, look } = event.data
  try {
    const textures = boardTextures(design, model, look)
    const buffers = [textures.top, textures.bottom].flatMap((t) => (t ? [t.rgba.buffer as ArrayBuffer] : []))
    ;(self as unknown as Worker).postMessage({ id, textures }, buffers)
  } catch (error) {
    ;(self as unknown as Worker).postMessage({ id, error: (error as Error).message })
  }
}
