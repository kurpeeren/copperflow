// Shared by the PCB and schematic renderers: the canvas surface they draw on and the colours.

/** The parts of CanvasRenderingContext2D the renderer uses, so it also runs against a test double. */
export interface Ctx {
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
  font: string
  textAlign: string
  textBaseline: string
  globalAlpha: number
  lineCap: string
  lineJoin: string
  /** The selection glow (schematic-theme.ts): a blur in device pixels, whatever the transform, and its colour. */
  shadowBlur?: number
  shadowColor?: unknown
  save(): void
  restore(): void
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  translate(x: number, y: number): void
  rotate(angle: number): void
  scale(x: number, y: number): void
  beginPath(): void
  closePath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arc(x: number, y: number, r: number, start: number, end: number): void
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void
  /** "evenodd" fills a pour with its holes left open; a Path2D is a pour's rings kept between redraws. */
  fill(pathOrRule?: Path2D | "evenodd" | "nonzero", rule?: "evenodd" | "nonzero"): void
  stroke(path?: Path2D): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number; actualBoundingBoxAscent?: number; actualBoundingBoxDescent?: number }
  clip(pathOrRule?: Path2D | "evenodd" | "nonzero", rule?: "evenodd" | "nonzero"): void
  setLineDash(segments: number[]): void
}

/**
 * The alpha of everything outside a highlighted net on the schematic. The PCB dims less, to PCB_DIM (below),
 * so its layer colours, pure blue among them, still read on black.
 */
export const HIGHLIGHT_DIM = 0.3

/** Alpha of everything outside a highlighted net on the PCB; high enough that dimmed pure blue still reads on black. */
export const PCB_DIM = 0.5

/** The interface's text stack: `--sans` in styles.css and the canvases' font family are this one string. */
export const UI_FONT_STACK = '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif'

/** The font family of all canvas text; each painter sets its own size and weight. */
export const CANVAS_FONT_FAMILY = UI_FONT_STACK

/** `--mono` in styles.css: for ids, code and the schematic's pin numbers (its digits are all one width). */
export const CANVAS_MONO_FAMILY = '"Cascadia Mono", "JetBrains Mono", ui-monospace, Consolas, monospace'

/** Designators and net names read a step bolder than values and pin names. */
export const TEXT_WEIGHT = { strong: 600, regular: 400 } as const

/** A canvas font string. */
export const canvasFont = (weight: number, px: number, family: string = CANVAS_FONT_FAMILY): string => `${weight} ${px}px ${family}`

/**
 * EasyEDA's default PCB theme, and every other colour the PCB draws in: the one source of them (PCB_LOOK in
 * overlays.ts picks its overlay colours from here). The board area has no fill: it stays the black background.
 */
export const PALETTE = {
  background: "#000000",
  boardEdge: "#ff00ff",
  topCopper: "#ff0000",
  bottomCopper: "#0000ff",
  /** The inner copper layers of a 4-layer board, which draw only their pours so far. */
  inner1Copper: "#cc9933",
  inner2Copper: "#9966cc",
  /** Pads of plated through-holes and via rings. */
  multiLayer: "#c0c0c0",
  viaRing: "#c0c0c0",
  /** A highlighted net, drawn in white over its layer colour. */
  highlight: "#ffffff",
  drill: "#222222",
  topSilk: "#ffcc00",
  bottomSilk: "#66cc33",
  /** Courtyards and fabrication outlines follow the assembly layers. */
  topAssembly: "#33cc99",
  bottomAssembly: "#5555ff",
  ratsnest: "#6464ff",
  keepout: "#f022f0",
  /** The document layer: our notes for the agent and the lock badges. */
  document: "#ffffff",
  /** The grid: white at 30% on minor lines and crossings, 50% on every fifth. */
  grid: "rgb(255 255 255 / 30%)",
  gridFifth: "rgb(255 255 255 / 50%)",
  /** The selection outline and its wash, and the dashed hover outline. */
  selection: "#ffffff",
  selectionFill: "rgb(255 255 255 / 50%)",
  hover: "rgb(255 255 255 / 60%)",
  /** The selection box, dotted, and its wash. */
  selectionBox: "#00ffff",
  selectionBoxFill: "rgb(0 255 255 / 10%)",
  /** Behind a note's text, so it reads over copper. */
  notePanel: "rgb(0 0 0 / 80%)",
  /** Violation markers, on both canvases. */
  error: "#e5534b",
  warning: "#e0a63a",
  /** The halos just outside and just inside a violation ring, on the PCB only. */
  ringHaloOuter: "#ffffff",
  ringHaloInner: "#000000",
}

/** Canvas baseline and alignment for anchors such as "top_left" or "center". */
export function anchorAlignment(anchor: string): [string, string] {
  const parts = anchor.split("_")
  const vertical = parts.includes("top") ? "top" : parts.includes("bottom") ? "bottom" : "middle"
  const horizontal = parts.includes("left") ? "left" : parts.includes("right") ? "right" : "center"
  return [vertical, horizontal]
}
