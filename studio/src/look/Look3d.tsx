import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react"
import type { Design } from "../api"
import type { LookRequest } from "../../../src/engine/fab/picture/looks.js"
import { solidModel } from "../../../src/engine/solid/model.js"
import { useElementSize } from "../pcb/canvas-common"
import { PALETTE } from "../pcb/ctx"
import { LookChooser, LookParts, LookReadout } from "./LookPanel"
import { BOTTOM, dragged, orbitKey, START, TOP, wheeled, type Orbit } from "./orbit"
import { partFaces } from "./parts/index"
import { renderScene, renderSmooth, type Frame } from "./raster"
import { hoverText } from "./readout"
import { buildScene, rgb } from "./scene"
import { useBoardTextures } from "./use-textures"
import "./look.css"

/** After the view has been still this long, it is drawn again finer: smooth edges and the board's picture blended. */
const REST_MS = 160

const HELP = "Drag to turn, wheel to zoom. Keys: arrows turn, + and − zoom, T top, B bottom, Home resets."

/**
 * The 3D view: the board as made, with its parts as lit simple shapes, turned with the mouse or the keys. It is a
 * look, not an editor: nothing can be changed here. The solids and pictures are made only while this view is open.
 * While it moves it is drawn at the screen's pixels; at rest, twice as fine and averaged down.
 */
export function Look3d({ design }: { design: Design }) {
  const model = useMemo(() => solidModel(design), [design])
  const [look, setLook] = useState<LookRequest>({})
  const { textures } = useBoardTextures(design, model, look)
  const parts = useMemo(() => partFaces(design, model), [design, model])
  const scene = useMemo(
    () => buildScene(model, { parts, ...(textures ? { textures } : {}), look, mounting: design.pcb.holes.length, layers: design.pcb.board?.layers ?? 2 }),
    [model, parts, textures, look, design],
  )
  const [resting, setResting] = useState(true)
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const frame = useRef<Frame | undefined>(undefined)
  const drag = useRef<{ x: number; y: number; orbit: Orbit } | undefined>(undefined)
  const size = useElementSize(host)
  const [orbit, setOrbit] = useState<Orbit>(START)
  const [hovered, setHovered] = useState<number | undefined>(undefined)
  const [focused, setFocused] = useState<number | undefined>(undefined)
  const [frameMs, setFrameMs] = useState<number | undefined>(undefined)
  const active = hovered ?? focused

  useEffect(() => {
    const element = canvas.current
    const { width, height } = size
    if (!element || width === 0 || height === 0) return
    const started = performance.now()
    const options = { background: rgb(PALETTE.background), highlight: active, reuse: frame.current, lit: true }
    frame.current = resting ? renderSmooth(scene, orbit, width, height, options) : renderScene(scene, orbit, width, height, options)
    if (element.width !== width) element.width = width
    if (element.height !== height) element.height = height
    element.getContext("2d")?.putImageData(new ImageData(frame.current.color as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0)
    if (!resting) setFrameMs(performance.now() - started)
  }, [scene, orbit, size, active, resting])

  // Moving: draw fast now, and finely once the view has been still a moment.
  useEffect(() => {
    setResting(false)
    const timer = setTimeout(() => setResting(true), REST_MS)
    return () => clearTimeout(timer)
  }, [orbit, size])

  // The wheel zooms the view, not the page: the listener must be able to stop the page from scrolling.
  useEffect(() => {
    const element = host.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      setOrbit((current) => wheeled(current, event.deltaY))
    }
    element.addEventListener("wheel", onWheel, { passive: false })
    return () => element.removeEventListener("wheel", onWheel)
  }, [])

  const local = (event: PointerEvent) => {
    const box = host.current?.getBoundingClientRect()
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }
  }
  const pick = (event: PointerEvent) => {
    const { x, y } = local(event)
    const shown = frame.current
    if (!shown || x < 0 || y < 0 || x >= shown.width || y >= shown.height) return undefined
    const id = shown.ids[Math.floor(y) * shown.width + Math.floor(x)] ?? -1
    return id >= 0 ? id : undefined
  }
  const named = active === undefined ? undefined : model.parts[active]

  return (
    <div className="look">
      <div
        className="look-view"
        ref={host}
        tabIndex={0}
        role="group"
        aria-label="3D view of the board and its parts; it cannot be edited here"
        aria-describedby="look-help"
        data-frame-ms={frameMs === undefined ? undefined : frameMs.toFixed(1)}
        onKeyDown={(event) => {
          const next = orbitKey(orbit, event.key)
          if (next === undefined) return
          event.preventDefault()
          setOrbit(next)
        }}
        onPointerDown={(event) => {
          // A press on a button stays the button's: capturing the pointer would take its click away.
          if ((event.target as Element).closest("button")) return
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { ...local(event), orbit }
        }}
        onPointerMove={(event) => {
          if (drag.current) {
            const { x, y } = local(event)
            setOrbit(dragged(drag.current.orbit, x - drag.current.x, y - drag.current.y))
          } else setHovered(pick(event))
        }}
        onPointerUp={() => (drag.current = undefined)}
        onPointerCancel={() => (drag.current = undefined)}
        onPointerLeave={() => setHovered(undefined)}
      >
        <canvas ref={canvas} />
        <div className="look-tools">
          <button type="button" onClick={() => setOrbit(TOP)}>
            Top
          </button>
          <button type="button" onClick={() => setOrbit(BOTTOM)}>
            Bottom
          </button>
          <button type="button" onClick={() => setOrbit(START)} title="Home">
            Reset view
          </button>
        </div>
        <p className="look-status" aria-live="polite">
          {named ? hoverText(named) : <span id="look-help">{HELP}</span>}
        </p>
      </div>
      <aside className="look-side">
        <LookReadout model={model} />
        <LookChooser look={look} onLook={setLook} ready={textures !== undefined} />
        <LookParts model={model} active={active} onActive={setFocused} />
      </aside>
    </div>
  )
}
