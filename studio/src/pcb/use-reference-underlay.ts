// The reference images under the PCB canvas: each image fetched once from the project, placed by its points (or by
// the points being picked) and made ready to draw; and the align tool, which takes a click on the picture and then a
// click on the board (snapping to a hole or pad) for each pair, writing the points from the second pair on.
import { useEffect, useMemo, useRef, useState } from "react"
import { apiBlob, type Design } from "../api"
import type { Actions } from "../use-actions"
import type { ReferenceRecord } from "../../../src/core/layout-references.js"
import type { FitPoint } from "../../../src/engine/reference-fit.js"
import type { Camera, Point } from "./geometry"
import type { Press } from "./press"
import type { PartPlaceTool } from "./use-part-place-tool"
import { aligningMatrix, alignHint, alignMarks, imagePixelAt, snapToBoard } from "./reference-align"
import { boardFrameOf, referenceLayer, type ImageCtx, type MakeCanvas, type ReferenceLayer } from "./reference-draw"
import { clearOverrides, overrideReference, pickBoardPoint, pickImagePoint, shownReferences, stopAligning, useReferenceState } from "./reference-store"

const fileUrl = (path: string) => `/api/file?path=${encodeURIComponent(path)}`

const makeCanvas: MakeCanvas = (width, height) => {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  return { canvas, ctx: canvas.getContext("2d") as unknown as ImageCtx }
}

/** Each reference's image, by file, fetched once; one that cannot be read is told once and left out. */
function useImages(records: readonly ReferenceRecord[], notify: (text: string) => void): ReadonlyMap<string, HTMLImageElement> {
  const [images, setImages] = useState<ReadonlyMap<string, HTMLImageElement>>(new Map())
  const [asked] = useState(() => new Set<string>())
  const files = records.map((r) => r.file).join("\n")
  useEffect(() => {
    for (const file of files.split("\n")) {
      if (file === "" || asked.has(file)) continue
      asked.add(file)
      apiBlob(fileUrl(file))
        .then((blob) => {
          const image = new Image()
          const url = URL.createObjectURL(blob)
          image.onload = () => setImages((now) => new Map(now).set(file, image))
          image.onerror = () => notify(`The reference image ${file} could not be shown`)
          image.src = url
        })
        .catch((error: Error) => notify(`The reference image ${file} could not be read: ${error.message}`))
    }
  }, [files, asked, notify])
  return images
}

export interface ReferenceUnderlay {
  /** The shown images, ready to draw under the board. */
  layers: readonly ReferenceLayer[]
  /** The points picked in this align run, to mark on the board. */
  marks: { placed: FitPoint[]; picked?: FitPoint }
  /** The align tool: it sees a press before the other tools while a reference is being aligned. */
  tool: PartPlaceTool
}

export function useReferenceUnderlay(design: Design, camera: Camera | undefined, actions: Pick<Actions, "reference" | "notify">): ReferenceUnderlay {
  const { aligning, overrides } = useReferenceState()
  // A build carries what was written: the values shown ahead of it are let go.
  useEffect(clearOverrides, [design.references])
  const records = useMemo(() => shownReferences(design.references, overrides), [design.references, overrides])
  const images = useImages(records, actions.notify)
  const board = useMemo(() => boardFrameOf(design.pcb), [design.pcb])
  const target = aligning ? records.find((r) => r.id === aligning.id) : undefined
  // A straightened image is kept by file and place, so a change of opacity alone redraws nothing but the board.
  const prepared = useRef(new Map<string, ReferenceLayer>())
  const layers = useMemo(() => {
    const kept = new Map<string, ReferenceLayer>()
    const shown = records.flatMap((record) => {
      const image = images.get(record.file)
      if (!image || !(record.shown || record.id === aligning?.id)) return []
      const placed = aligningMatrix(record, aligning, board)
      const key = `${record.file}|${placed.join(",")}`
      const layer = prepared.current.get(key) ?? referenceLayer(record, image, board, makeCanvas, placed)
      kept.set(key, layer)
      return [{ ...layer, id: record.id, opacity: record.opacity }]
    })
    prepared.current = kept
    return shown
  }, [records, images, board, aligning])
  const matrix = target ? aligningMatrix(target, aligning, board) : undefined
  useEffect(() => {
    if (!target) return
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") stopAligning()
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [target])
  const press = (event: Press, world: Point): boolean => {
    if (!target || !matrix || !aligning || !camera) return false
    if (event.button !== 0) {
      stopAligning()
      return true
    }
    if (!aligning.picked) {
      const pixel = imagePixelAt(matrix, world)
      if (pixel) pickImagePoint(pixel)
      return true
    }
    const points = pickBoardPoint(snapToBoard(world, design.pcb, camera.scale))
    if (points.length >= 2) {
      overrideReference(target.id, { points })
      void actions.reference({ action: "set", id: target.id, points })
    }
    return true
  }
  const marks = useMemo(() => (matrix ? alignMarks(matrix, aligning) : { placed: [] }), [matrix, aligning])
  return { layers, marks, tool: { armed: target !== undefined, press, hint: aligning && target ? alignHint(aligning) : undefined } }
}
