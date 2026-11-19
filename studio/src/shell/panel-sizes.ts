// The side panels' widths and the bottom panel's height, set by dragging the splitters at their inner edges: the
// limits in a window, the size a drag or a key gives, what is shown for the remembered sizes, and the remembering.
// The sizes a person chose are kept as they are; what is shown is derived from them and the window, so a smaller
// window shrinks the panels and a larger one gives the chosen sizes back without a jump. Plain TypeScript, so the
// tests run it without a DOM.
import type { ThemeStore } from "./theme-state.js"

/** The panel a splitter sizes, named by the edge of the window it sits at. */
export type PanelEdge = "left" | "right" | "bottom"

export interface PanelSizes {
  readonly left: number
  readonly right: number
  readonly bottom: number
}

export interface Viewport {
  readonly width: number
  readonly height: number
}

export interface SizeLimits {
  readonly min: number
  readonly max: number
}

/** Which side panels are open: a collapsed one takes no room. */
export interface OpenSides {
  readonly left: boolean
  readonly right: boolean
}

export const DEFAULT_PANEL_SIZES: PanelSizes = { left: 262, right: 262, bottom: 240 }

export const SIDE_MIN_WIDTH = 180
/** A side panel takes at most this share of the window's width. */
export const SIDE_MAX_SHARE = 0.45
export const BOTTOM_MIN_HEIGHT = 120
/** The bottom panel takes at most this share of the window's height. */
export const BOTTOM_MAX_SHARE = 0.6
/** The canvas is never pushed narrower than this by the side panels. */
export const CANVAS_MIN_WIDTH = 320
/** The two 24px tab strips at the window's edges (strips.css), which stay when the panels collapse. */
export const STRIPS_WIDTH = 2 * 24

/** A splitter key moves the edge this far; with Shift, the larger step. */
export const KEY_STEP = 16
export const KEY_STEP_LARGE = 64

/** The browser storage key the sizes are kept under. */
export const PANEL_SIZES_KEY = "copperflow.panels"
/** A stored size above this is damage, not a choice: no screen is that large. */
const STORED_MAX = 10000

const MINIMUM: PanelSizes = { left: SIDE_MIN_WIDTH, right: SIDE_MIN_WIDTH, bottom: BOTTOM_MIN_HEIGHT }

const clampTo = (value: number, limits: SizeLimits): number => Math.min(limits.max, Math.max(limits.min, Math.round(value)))

/** What the canvas row leaves for both side panels together. */
const sideRoom = (viewport: Viewport): number => viewport.width - STRIPS_WIDTH - CANVAS_MIN_WIDTH

/** A side panel's range in this window, beside the other side's shown width (0 when it is collapsed). */
export function sideLimits(viewport: Viewport, other: number): SizeLimits {
  const share = Math.floor(viewport.width * SIDE_MAX_SHARE)
  return { min: SIDE_MIN_WIDTH, max: Math.max(SIDE_MIN_WIDTH, Math.min(share, sideRoom(viewport) - other)) }
}

export function bottomLimits(viewport: Viewport): SizeLimits {
  return { min: BOTTOM_MIN_HEIGHT, max: Math.max(BOTTOM_MIN_HEIGHT, Math.floor(viewport.height * BOTTOM_MAX_SHARE)) }
}

/**
 * Two open side panels that would leave the canvas too little: each gives up room in proportion to how far it is
 * above its minimum, so both shrink together and neither jumps.
 */
function shareRoom(left: number, right: number, room: number): [number, number] {
  const overflow = left + right - room
  if (overflow <= 0) return [left, right]
  const spareLeft = left - SIDE_MIN_WIDTH
  const spare = spareLeft + right - SIDE_MIN_WIDTH
  if (spare <= 0) return [left, right]
  const cut = Math.min(overflow, spare)
  const newLeft = left - Math.round((cut * spareLeft) / spare)
  return [newLeft, left + right - cut - newLeft]
}

/** The sizes shown in this window for the remembered ones. A closed side keeps its own limits, for when it opens. */
export function shownSizes(preferred: PanelSizes, viewport: Viewport, open: OpenSides): PanelSizes {
  const own = sideLimits(viewport, 0)
  const left = clampTo(preferred.left, own)
  const right = clampTo(preferred.right, own)
  const bottom = clampTo(preferred.bottom, bottomLimits(viewport))
  if (!open.left || !open.right) return { left, right, bottom }
  const [shownLeft, shownRight] = shareRoom(left, right, sideRoom(viewport))
  return { left: shownLeft, right: shownRight, bottom }
}

/** Which way a pointer move along the splitter's axis changes the panel: the right and bottom panels grow toward the canvas's far side. */
const GROWTH: Record<PanelEdge, 1 | -1> = { left: 1, right: -1, bottom: -1 }

/** The size a drag gives: the size it started at, moved by how far the pointer went along the splitter's axis. */
export function dragSize(edge: PanelEdge, startSize: number, moved: number, limits: SizeLimits): number {
  return clampTo(startSize + GROWTH[edge] * moved, limits)
}

/** The arrow keys of each splitter's axis and the way each moves the edge: the side splitters' Left and Right, the bottom one's Up and Down. */
const ARROWS: Record<PanelEdge, Readonly<Record<string, 1 | -1>>> = {
  left: { ArrowRight: 1, ArrowLeft: -1 },
  right: { ArrowLeft: 1, ArrowRight: -1 },
  bottom: { ArrowUp: 1, ArrowDown: -1 },
}

/** A key press as the splitter reads it. */
export interface SplitterPress {
  key: string
  shiftKey: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

/** The size a key on a focused splitter gives, or null when the key is not the splitter's (a shortcut with Ctrl, Alt or Meta never is). */
export function keySize(edge: PanelEdge, press: SplitterPress, current: number, limits: SizeLimits): number | null {
  if (press.ctrlKey || press.altKey || press.metaKey) return null
  if (press.key === "Home") return limits.min
  if (press.key === "End") return limits.max
  if (press.key === "Enter") return DEFAULT_PANEL_SIZES[edge]
  const way = ARROWS[edge][press.key]
  if (way === undefined) return null
  return clampTo(current + way * (press.shiftKey ? KEY_STEP_LARGE : KEY_STEP), limits)
}

/** One stored size: a damaged one (not a number, not positive, absurdly large) reads as the default, a small one as the minimum. */
function storedSize(value: unknown, edge: PanelEdge): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > STORED_MAX) return DEFAULT_PANEL_SIZES[edge]
  return Math.max(MINIMUM[edge], Math.round(value))
}

/** The stored text as sizes. A damaged value is not an error worth showing: it only means the default sizes. */
export function parseStoredSizes(text: string | null | undefined): PanelSizes {
  let value: unknown
  try {
    value = JSON.parse(text ?? "")
  } catch {
    return DEFAULT_PANEL_SIZES
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return DEFAULT_PANEL_SIZES
  const fields = value as Record<string, unknown>
  return { left: storedSize(fields.left, "left"), right: storedSize(fields.right, "right"), bottom: storedSize(fields.bottom, "bottom") }
}

/** The remembered sizes; the defaults when nothing is kept or the storage is blocked (`store` may itself throw). */
export function loadPanelSizes(store: () => ThemeStore | undefined): PanelSizes {
  try {
    return parseStoredSizes(store()?.getItem(PANEL_SIZES_KEY))
  } catch {
    // Blocked site data: the panels open at their defaults, as on a first visit.
    return DEFAULT_PANEL_SIZES
  }
}

/** Remembers the sizes; false when the storage is missing or blocked, and the sizes still hold for this visit. */
export function savePanelSizes(store: () => ThemeStore | undefined, sizes: PanelSizes): boolean {
  try {
    const storage = store()
    if (!storage) return false
    storage.setItem(PANEL_SIZES_KEY, JSON.stringify({ left: sizes.left, right: sizes.right, bottom: sizes.bottom }))
    return true
  } catch {
    return false
  }
}
