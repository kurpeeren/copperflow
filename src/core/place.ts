import { posix } from "node:path"
import { componentName, LIBRARY_OWNED_PROPS, libraryIds, PARTS_DIR } from "./library.js"
import type { Author } from "./history.js"
import type { CircuitModel, Literal } from "./types.js"
import { editCircuit, loadCircuit, type EditResult } from "./workspace.js"

/** tscircuit parts that need no library entry. */
export const BUILTIN_PARTS = [
  "resistor",
  "capacitor",
  "inductor",
  "led",
  "diode",
  "fuse",
  "crystal",
  "resonator",
  "pinheader",
  "pushbutton",
  "switch",
  "testpoint",
  "transistor",
  "mosfet",
  "battery",
  "potentiometer",
] as const

/** The usual designator prefix of each built-in part; library parts are U. */
const PREFIXES: Record<string, string> = {
  resistor: "R",
  capacitor: "C",
  inductor: "L",
  led: "LED",
  diode: "D",
  fuse: "F",
  crystal: "Y",
  resonator: "Y",
  pinheader: "J",
  pushbutton: "SW",
  switch: "SW",
  testpoint: "TP",
  transistor: "Q",
  mosfet: "Q",
  battery: "BT",
  potentiometer: "RV",
}

export interface PlaceRequest {
  /** A library part id (see list_parts) or a built-in part such as "resistor". */
  part: string
  /** The designator; when omitted the next free one is used, e.g. R5. */
  name?: string
  props?: Record<string, Literal>
}

/** The next free designator for a part: R1, R2, ... or U1, U2, ... for library parts. */
export function suggestName(model: CircuitModel, part: string, isLibraryPart: boolean): string {
  const prefix = isLibraryPart ? "U" : (PREFIXES[part] ?? "X")
  const pattern = new RegExp(`^${prefix}(\\d+)$`)
  const highest = Math.max(0, ...model.parts.map((p) => Number(pattern.exec(p.name)?.[1] ?? 0)))
  return `${prefix}${highest + 1}`
}

/** Adds a library or built-in part to a circuit; a library part also gets its import. */
export async function placePart(
  root: string,
  file: string,
  request: PlaceRequest,
  meta: { author: Author },
): Promise<EditResult & { name: string }> {
  const circuit = await loadCircuit(root, file)
  const builtin = (BUILTIN_PARTS as readonly string[]).includes(request.part)
  const name = request.name ?? suggestName(circuit.model, request.part, !builtin)
  const props = request.props ? { props: request.props } : {}
  const summary = `place ${name} (${request.part})`
  if (builtin) {
    const result = await editCircuit(root, file, [{ kind: "addPart", tag: request.part, name, ...props }], { ...meta, summary })
    return { ...result, name }
  }
  // Exact folder names, so "ldo" does not match "LDO" on a case-insensitive disk.
  if (!(await libraryIds(root)).includes(request.part)) {
    throw new Error(`Unknown part "${request.part}": use a library part id from list_parts or one of ${BUILTIN_PARTS.join(", ")}`)
  }
  const owned = Object.keys(request.props ?? {}).find((key) => LIBRARY_OWNED_PROPS.includes(key))
  if (owned) throw new Error(`${owned} comes from ${PARTS_DIR}/${request.part}/part.yaml; change it there`)
  const tag = componentName(request.part)
  // Both paths are project-relative, so the import does not depend on how the root is spelled.
  let importFrom = posix.relative(posix.dirname(circuit.file), `${PARTS_DIR}/${request.part}/${tag}`)
  if (!importFrom.startsWith(".")) importFrom = `./${importFrom}`
  const result = await editCircuit(root, file, [{ kind: "addPart", tag, name, importFrom, ...props }], { ...meta, summary })
  return { ...result, name }
}
