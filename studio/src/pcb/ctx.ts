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
  fill(): void
  stroke(): void
  fillText(text: string, x: number, y: number): void
  clip(): void
  setLineDash(segments: number[]): void
}

export interface Layers {
  topCopper: boolean
  bottomCopper: boolean
  silkscreen: boolean
  courtyard: boolean
  fabrication: boolean
}

/** The alpha of everything outside a highlighted net, on the PCB and the schematic alike. */
export const HIGHLIGHT_DIM = 0.3

/** EasyEDA's default PCB theme. The board area has no fill: it stays the black background. */
export const PALETTE = {
  background: "#000000",
  boardEdge: "#ff00ff",
  topCopper: "#ff0000",
  bottomCopper: "#0000ff",
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
  /** Violation markers, on both canvases. */
  error: "#e5534b",
  warning: "#e0a63a",
}

/** Canvas baseline and alignment for anchors such as "top_left" or "center". */
export function anchorAlignment(anchor: string): [string, string] {
  const parts = anchor.split("_")
  const vertical = parts.includes("top") ? "top" : parts.includes("bottom") ? "bottom" : "middle"
  const horizontal = parts.includes("left") ? "left" : parts.includes("right") ? "right" : "center"
  return [vertical, horizontal]
}
