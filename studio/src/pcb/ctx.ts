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

export const PALETTE = {
  board: "#15231b",
  boardEdge: "rgb(233 230 223 / 55%)",
  topCopper: "#d0874a",
  bottomCopper: "#4f7fc4",
  highlight: "#ffd08a",
  drill: "#0c0e11",
  viaRing: "#c9a36a",
  topSilk: "#ece6da",
  bottomSilk: "#8d9aab",
  courtyard: "rgb(233 230 223 / 30%)",
  fabrication: "rgb(149 156 166 / 55%)",
  ratsnest: "#e9e6df",
}

/** Canvas baseline and alignment for anchors such as "top_left" or "center". */
export function anchorAlignment(anchor: string): [string, string] {
  const parts = anchor.split("_")
  const vertical = parts.includes("top") ? "top" : parts.includes("bottom") ? "bottom" : "middle"
  const horizontal = parts.includes("left") ? "left" : parts.includes("right") ? "right" : "center"
  return [vertical, horizontal]
}
