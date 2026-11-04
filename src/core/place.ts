import { posix } from "node:path"
import { componentName, LIBRARY_OWNED_PROPS, libraryIds, PARTS_DIR } from "./library.js"
import type { Author } from "./history.js"
import type { Literal } from "./types.js"
import { editCircuit, resolveCircuit, type EditResult } from "./workspace.js"

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

export interface PlaceRequest {
  /** A library part id (see list_parts) or a built-in part such as "resistor". */
  part: string
  name: string
  props?: Record<string, Literal>
}

/** Adds a library or built-in part to a circuit; a library part also gets its import. */
export async function placePart(
  root: string,
  file: string,
  request: PlaceRequest,
  meta: { author: Author },
): Promise<EditResult> {
  const circuit = await resolveCircuit(root, file)
  const props = request.props ? { props: request.props } : {}
  const summary = `place ${request.name} (${request.part})`
  if ((BUILTIN_PARTS as readonly string[]).includes(request.part)) {
    return editCircuit(root, file, [{ kind: "addPart", tag: request.part, name: request.name, ...props }], { ...meta, summary })
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
  return editCircuit(root, file, [{ kind: "addPart", tag, name: request.name, importFrom, ...props }], { ...meta, summary })
}
