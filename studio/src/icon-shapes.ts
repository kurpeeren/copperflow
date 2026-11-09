// Studio's own icon set, as data: every glyph on a 16-unit grid, drawn in 1.5px strokes with round caps and joins
// (icon-svg.ts adds those), coordinates on whole or half units and at least half a unit inside the square. The
// toolbar, the menus and the Properties buttons draw from this one family. A test checks the grid and the strokes.

/** One shape of a glyph. A filled shape (`fill: true`) fills in the text colour and draws no stroke. */
export type Shape =
  | { readonly tag: "path"; readonly d: string; readonly dash?: string }
  | { readonly tag: "circle"; readonly cx: number; readonly cy: number; readonly r: number; readonly fill?: true }
  | { readonly tag: "rect"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rx?: number; readonly fill?: true; readonly dash?: string }

const path = (d: string, dash?: string): Shape => (dash ? { tag: "path", d, dash } : { tag: "path", d })
const circle = (cx: number, cy: number, r: number, fill?: true): Shape => (fill ? { tag: "circle", cx, cy, r, fill } : { tag: "circle", cx, cy, r })
const rect = (x: number, y: number, width: number, height: number, rx = 1, fill?: true): Shape => (fill ? { tag: "rect", x, y, width, height, rx, fill } : { tag: "rect", x, y, width, height, rx })

/** Fit's four corner brackets. */
const CORNERS = path("M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3")
/** A padlock's body and keyhole. */
const LOCK_BODY = [rect(3, 7, 10, 7, 1.5), path("M8 10v1.5")]
/** Grid dots, three by three. */
const DOTS = [4, 8, 12].flatMap((y) => [4, 8, 12].map((x) => circle(x, y, 1, true)))

export const ICONS = {
  // Properties and panels
  lock: [...LOCK_BODY, path("M5.5 7V5a2.5 2.5 0 0 1 5 0v2")],
  /** The shackle's right leg stops short of the body: open. */
  unlock: [...LOCK_BODY, path("M5.5 7V5a2.5 2.5 0 0 1 5 0")],
  trash: [path("M2.5 4.5h11M6 4.5V2.5h4v2"), path("M4 4.5l.5 9h7l.5-9"), path("M6.5 7v4M9.5 7v4")],
  close: [path("M4 4l8 8M12 4l-8 8")],
  chevron: [path("M6 4l4 4-4 4")],
  eye: [path("M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"), circle(8, 8, 2)],
  eyeOff: [path("M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"), circle(8, 8, 2), path("M2.5 2.5l11 11")],

  // History
  undo: [path("M5.5 3 3 5.5 5.5 8"), path("M3 5.5h6.5a3.5 3.5 0 0 1 0 7h-3")],
  /** Undo, mirrored. */
  redo: [path("M10.5 3 13 5.5 10.5 8"), path("M13 5.5H6.5a3.5 3.5 0 0 0 0 7h3")],

  // View
  zoomIn: [circle(7, 7, 4.5), path("M10.5 10.5 14 14M7 5v4M5 7h4")],
  zoomOut: [circle(7, 7, 4.5), path("M10.5 10.5 14 14M5 7h4")],
  fit: [CORNERS, rect(6, 6, 4, 4, 0.5)],
  /** Fit's corners round a filled box: the selection alone. */
  fitSelection: [CORNERS, rect(5.5, 5.5, 5, 5, 1, true)],
  /** A dashed box with an arrow out of it: drag a box to zoom to it. */
  fitArea: [rect(2.5, 2.5, 8, 8, 1), path("M7 7l6.5 6.5M13.5 9.5v4h-4")].map((shape) => (shape.tag === "rect" ? { ...shape, dash: "2 2" } : shape)),
  grid: DOTS,
  /** A magnet: positions are drawn to the grid. */
  snap: [path("M3.5 2.5V8a4.5 4.5 0 0 0 9 0V2.5h-3V8a1.5 1.5 0 0 1-3 0V2.5z"), path("M3.5 5h3M9.5 5h3")],

  // Place
  component: [rect(4.5, 3, 7, 10, 1), path("M2 6h2.5M2 10h2.5M11.5 6H14M11.5 10H14")],
  wire: [circle(3.5, 12.5, 1.5), circle(12.5, 3.5, 1.5), path("M5 12.5h3.5v-9H11")],
  netLabel: [path("M1.5 8h2"), path("M5.5 4.5h8v7h-8L3.5 8z"), path("M8 8h3")],
  ground: [path("M8 2.5v6M3 8.5h10M5 11h6M7 13.5h2")],
  power: [path("M8 14V5.5M3.5 5.5h9"), path("M3.5 5.5 8 2l4.5 3.5")],

  // Edit
  /** A counter-clockwise turn: the arrow runs round from the left and ends at the top, pointing left. */
  rotate: [path("M3 8a5 5 0 1 0 5-5"), path("M9.5 1.5 8 3l1.5 1.5")],
  /** Rotate, mirrored: a clockwise turn. */
  rotateRight: [path("M13 8a5 5 0 1 1-5-5"), path("M6.5 1.5 8 3 6.5 4.5")],
  alignLeft: [path("M2.5 2v12"), rect(5, 3.5, 8.5, 3.5, 1), rect(5, 9, 5, 3.5, 1)],
  distributeH: [path("M2.5 2v12M13.5 2v12"), rect(6, 4, 4, 8, 1)],

  // Design
  /** A shield with a tick: the design checks. */
  check: [path("M8 1.5 3 3.5v4c0 3 2 5.5 5 6.5 3-1 5-3.5 5-6.5v-4z"), path("M5.5 8l2 2 3-3.5")],
} as const satisfies Record<string, readonly Shape[]>

export type IconName = keyof typeof ICONS
