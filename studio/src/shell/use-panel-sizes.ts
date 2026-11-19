// The panel sizes as the workspace uses them: the remembered sizes, the window they are shown in, and the CSS
// properties on the workspace row that strips.css and bottom.css size the panels by. The arithmetic is panel-sizes.ts.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { animationFrames, frameThrottle } from "./frame-throttle"
import { bottomLimits, loadPanelSizes, savePanelSizes, shownSizes, sideLimits, type OpenSides, type PanelEdge, type PanelSizes, type SizeLimits, type Viewport } from "./panel-sizes"
import { browserStore } from "./theme-state"

/** The CSS property each panel's size is set by, on the workspace row. */
const SIZE_PROPERTY: Record<PanelEdge, string> = { left: "--left-panel-width", right: "--right-panel-width", bottom: "--bottom-panel-height" }

/** What a splitter needs: the size shown, its range, and the two ways to change it. */
export interface PanelSplitter {
  size: number
  limits: SizeLimits
  /** While dragging: sizes the panel at once, without a render of the workspace. */
  onLive(size: number): void
  /** A finished drag, a key or a double click: the size is chosen and remembered. */
  onCommit(size: number): void
}

const windowSize = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight })

/** The window's size, followed at most once per frame while it is resized. */
function useViewport(): Viewport {
  const [viewport, setViewport] = useState(windowSize)
  useEffect(() => {
    const throttle = frameThrottle(animationFrames(), (next: Viewport) => setViewport((current) => (current.width === next.width && current.height === next.height ? current : next)))
    const onResize = () => throttle.push(windowSize())
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      throttle.cancel()
    }
  }, [])
  return viewport
}

/** Remembers each new choice; the sizes read at the start are not written back. */
function useRememberSizes(sizes: PanelSizes): void {
  const saved = useRef(sizes)
  useEffect(() => {
    if (saved.current === sizes) return
    saved.current = sizes
    // A false result means blocked site data: the sizes still hold for this visit, and there is nothing to ask the
    // person, as with the theme.
    savePanelSizes(browserStore, sizes)
  }, [sizes])
}

/** The sizes for the workspace row: its ref and style, and each splitter's props. `open`: the side panels shown. */
export function usePanelSizes(open: OpenSides) {
  const root = useRef<HTMLElement>(null)
  const [preferred, setPreferred] = useState(() => loadPanelSizes(browserStore))
  const viewport = useViewport()
  useRememberSizes(preferred)
  const shown = shownSizes(preferred, viewport, open)
  const live = useCallback((edge: PanelEdge, size: number) => root.current?.style.setProperty(SIZE_PROPERTY[edge], `${size}px`), [])
  const commit = useCallback((edge: PanelEdge, size: number) => setPreferred((current) => (current[edge] === size ? current : { ...current, [edge]: size })), [])
  const limits: Record<PanelEdge, SizeLimits> = {
    left: sideLimits(viewport, open.right ? shown.right : 0),
    right: sideLimits(viewport, open.left ? shown.left : 0),
    bottom: bottomLimits(viewport),
  }
  const splitter = (edge: PanelEdge): PanelSplitter => ({ size: shown[edge], limits: limits[edge], onLive: (size) => live(edge, size), onCommit: (size) => commit(edge, size) })
  const style = Object.fromEntries((["left", "right", "bottom"] as const).map((edge) => [SIZE_PROPERTY[edge], `${shown[edge]}px`])) as CSSProperties
  return { root, style, left: splitter("left"), right: splitter("right"), bottom: splitter("bottom") }
}
