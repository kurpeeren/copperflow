// The board's pictures for the 3D view, made once per design and look, off the page's thread when a worker can run
// (else after the first paint, on it). Until they are there the view shows the plain board. Turning or zooming the
// view never asks for new ones: they depend on the design and the look alone.
import { useEffect, useState } from "react"
import type { Design } from "../api"
import type { LookRequest } from "../../../src/engine/fab/picture/looks.js"
import type { SolidModel } from "../../../src/engine/solid/model.js"
import { boardTextures, lookKey, type BoardTextures } from "./texture"

let nextId = 0

function inWorker(design: Design, model: SolidModel, look: LookRequest): Promise<BoardTextures> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./texture-worker.ts", import.meta.url), { type: "module" })
    const id = ++nextId
    worker.onmessage = (event: MessageEvent) => {
      worker.terminate()
      if (event.data.id !== id) return
      if (event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.textures as BoardTextures)
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message))
    }
    worker.postMessage({ id, design, model, look })
  })
}

/** After the page has painted: the fallback when no worker can run. */
const afterPaint = (make: () => BoardTextures): Promise<BoardTextures> =>
  new Promise((resolve) => setTimeout(() => resolve(make()), 50))

export function useBoardTextures(design: Design, model: SolidModel, look: LookRequest): { textures: BoardTextures | undefined; ms: number | undefined } {
  const key = lookKey(look)
  const [made, setMade] = useState<{ design: Design; key: string; textures: BoardTextures; ms: number } | undefined>(undefined)
  useEffect(() => {
    let live = true
    const started = performance.now()
    const done = (textures: BoardTextures) => live && setMade({ design, key, textures, ms: performance.now() - started })
    const fallback = () => afterPaint(() => boardTextures(design, model, look)).then(done)
    if (typeof Worker === "undefined") void fallback()
    else inWorker(design, model, look).then(done, fallback)
    return () => {
      live = false
    }
    // The look is in `key`; the model follows the design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, key])
  const current = made && made.design === design && made.key === key ? made : undefined
  return { textures: current?.textures, ms: current?.ms }
}
