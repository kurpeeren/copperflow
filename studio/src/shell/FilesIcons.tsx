// The Files tab's icons, one per kind of file, picked by name (fileIconKind in files-tree.ts). They follow the Studio's
// icon family (icon-svg.ts): a 16-unit grid at 16px, 1.5px round strokes; each family has its colour in
// files-panel.css (the board's own files copper, fabrication files mask green, pictures and models amber). They live
// here rather than in icon-shapes.ts because only this tab draws them.
import type { ReactElement } from "react"
import type { FileIconKind } from "./files-tree"

const PAGE = "M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3"
const BOARD = "M1.5 3.5h13v9h-13z"
const DISC = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`

/** Each kind's path data, drawn over the same 16-unit square. */
const GLYPHS: Record<FileIconKind, string> = {
  folder: "M1.5 4.5a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z",
  link: `${PAGE} M6 12l4-4 M7.5 8h2.5v2.5`,
  file: PAGE,
  // A chip with its legs: the board's top circuit.
  circuit: "M4.5 3.5h7v9h-7z M2.5 5.5h2 M2.5 8h2 M2.5 10.5h2 M11.5 5.5h2 M11.5 8h2 M11.5 10.5h2",
  // A resistor's zigzag on a page: a sheet a circuit uses.
  sheet: `${PAGE} M5 10h1l1-2 1.5 4 1-2h1.5`,
  // A board with a track between two pads: the layout and boards from other programs.
  layout: `${BOARD} ${DISC(4.5, 9.5, 1)} ${DISC(11.5, 6.5, 1)} M5.5 9.5h2.5l2.5-3`,
  markdown: `${PAGE} M5 13v-4l1.5 1.5 1.5-1.5v4 M10.5 9v4 M9.25 11.75l1.25 1.25 1.25-1.25`,
  config: `${PAGE} M7 7.5c-1 0-1 .5-1 1.5s-.5 1.25-1 1.25c.5 0 1 .25 1 1.25s0 1.5 1 1.5 M9 7.5c1 0 1 .5 1 1.5s.5 1.25 1 1.25c-.5 0-1 .25-1 1.25s0 1.5-1 1.5`,
  table: `${PAGE} M5 7.5h6v5.5h-6z M5 10.25h6 M8 7.5v5.5`,
  image: "M2.5 3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z M2.5 11l3-3 3 3 2-2 3 3 M10 5.5h.5",
  archive: `${PAGE} M7.5 1.5v1 M8.5 3v1 M7.5 4.5v1 M8.5 6v1 M7 8.5h2v2.5h-2z`,
  web: `${DISC(8, 8, 6.5)} M1.5 8h13 M8 1.5c2 2 2 11 0 13 M8 1.5c-2 2-2 11 0 13`,
  model: "M8 1.5l5.5 3v7l-5.5 3-5.5-3v-7z M2.5 4.5l5.5 3 5.5-3 M8 7.5v7",
  // Stacked layers: the Gerber files, one per layer of the board.
  gerber: "M8 2l6 3-6 3-6-3z M2 8l6 3 6-3 M2 11l6 3 6-3",
  drill: `${DISC(8, 8, 5.5)} ${DISC(8, 8, 1.5)}`,
  pdf: `${PAGE} M5 8h6v3h-6z M5 13h4`,
  code: `${PAGE} M6.5 8.5l-1.5 1.75 1.5 1.75 M9.5 8.5l1.5 1.75-1.5 1.75`,
  text: `${PAGE} M5.5 8h5 M5.5 10.5h5 M5.5 13h3`,
}

export function FileKindIcon({ kind }: { kind: FileIconKind }): ReactElement {
  return (
    <svg className={`files-icon k-${kind}`} width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={GLYPHS[kind]} />
    </svg>
  )
}
