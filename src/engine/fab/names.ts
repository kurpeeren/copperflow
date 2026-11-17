// The fabrication files' names, after JLCPCB's conventions: `<name>-F_Cu.gtl` and the like, all in `<name>-fab/` beside
// the circuit, plus `<name>-fab.zip`. Pure string handling.

/** The Gerber layers copperflow writes; the inner copper layers only for a 4-layer board. */
export const GERBER_LAYERS = [
  "F_Cu",
  "In1_Cu",
  "In2_Cu",
  "B_Cu",
  "F_Mask",
  "B_Mask",
  "F_Paste",
  "B_Paste",
  "F_Silkscreen",
  "B_Silkscreen",
  "Edge_Cuts",
] as const
export type GerberLayerName = (typeof GERBER_LAYERS)[number]

/** The other files of the set: plated and non-plated drills, pick-and-place, the bill of materials and the pictures. */
export const OTHER_FILES = ["PTH", "NPTH", "pick-and-place", "bom", "top", "bottom"] as const
export type OtherFileName = (typeof OTHER_FILES)[number]

const EXTENSIONS: Readonly<Record<GerberLayerName | OtherFileName, string>> = {
  F_Cu: "gtl",
  In1_Cu: "g2",
  In2_Cu: "g3",
  B_Cu: "gbl",
  F_Mask: "gts",
  B_Mask: "gbs",
  F_Paste: "gtp",
  B_Paste: "gbp",
  F_Silkscreen: "gto",
  B_Silkscreen: "gbo",
  Edge_Cuts: "gm1",
  PTH: "drl",
  NPTH: "drl",
  "pick-and-place": "csv",
  bom: "csv",
  top: "png",
  bottom: "png",
}

const CIRCUIT_SUFFIX = ".circuit.tsx"

/** The design's name from its circuit file: "boards/can-module.circuit.tsx" is "can-module". */
export function designName(circuitFile: string): string {
  const base = circuitFile.split(/[\\/]/).pop() ?? circuitFile
  return base.endsWith(CIRCUIT_SUFFIX) ? base.slice(0, -CIRCUIT_SUFFIX.length) : base.replace(/\.[^.]*$/, "")
}

/** "can-module-F_Cu.gtl" for the top copper of "can-module". */
export const fabFileName = (name: string, file: GerberLayerName | OtherFileName): string => `${name}-${file}.${EXTENSIONS[file]}`

/** The folder the files go in, beside the circuit: "can-module-fab". */
export const fabFolderName = (name: string): string => `${name}-fab`

/**
 * The upload step after an export, starting with "upload": the zip goes to JLCPCB's PCB order, the BOM and
 * pick-and-place CSVs to its assembly step. Both CSVs are in the folder, and the zip keeps them too. `zip` and `folder`
 * may carry a path; `files` are the written files' names.
 */
export function uploadStep(zip: string, folder: string, files: readonly string[]): string {
  const named = (suffix: string, fallback: string) => files.find((name) => name.endsWith(suffix)) ?? fallback
  const zipName = zip.split("/").pop() ?? zip
  return `upload ${zipName} to JLCPCB's PCB order, and ${named("-bom.csv", "the BOM")} and ${named("-pick-and-place.csv", "the pick-and-place file")} from ${folder}/ at its assembly step (the zip holds them too)`
}

/** The zip of the folder: "can-module-fab.zip". */
export const fabZipName = (name: string): string => `${fabFolderName(name)}.zip`
