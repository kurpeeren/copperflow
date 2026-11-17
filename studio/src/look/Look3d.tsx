import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react"
import type { Design } from "../api"
import { solidModel } from "../../../src/engine/solid/model.js"
import { useElementSize } from "../pcb/canvas-common"
import { PALETTE } from "../pcb/ctx"
import { LookParts, LookReadout } from "./LookPanel"
import { BOTTOM, dragged, orbitKey, START, TOP, wheeled, type Orbit } from "./orbit"
import { renderScene, type Frame } from "./raster"
import { hoverText } from "./readout"
import { buildScene, rgb } from "./scene"
import "./look.css"

const HELP = "Drag to turn, wheel to zoom. Keys: arrows turn, + and − zoom, T top, B bottom, Home resets."

/**
 * The 3D view: the board and its parts as boxes, turned with the mouse or the keys. It is a look, not an editor:
 * nothing can be changed here. The solids are made only while this view is open.
 */
export function Look3d({ design }: { design: Design }) {
  const model = useMemo(() => solidModel(design), [design])
  const scene = useMemo(() => buildScene(model), [model])
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
    frame.current = renderScene(scene, orbit, width, height, { background: rgb(PALETTE.background), highlight: active, reuse: frame.current })
    element.width = width
    element.height = height
    element.getContext("2d")?.putImageData(new ImageData(frame.current.color as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0)
    setFrameMs(performance.now() - started)
  }, [scene, orbit, size, active])

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
        <LookParts model={model} active={active} onActive={setFocused} />
      </aside>
    </div>
  )
}
