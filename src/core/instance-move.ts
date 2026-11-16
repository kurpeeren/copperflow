// The layout file's change when edits move sub-sheet instances: their inner copper goes with them (instance-copper.ts).
import { buildWith, type DesignSource } from "./design-source.js"
import { readIfThere } from "./file-writes.js"
import type { FileChange } from "./history.js"
import { carriedCopper, type Frame, type InstanceMove } from "./instance-copper.js"
import { layoutPathFor, readLayoutText, serializeLayout } from "./layout-file.js"
import type { Design } from "../engine/design.js"
import type { CircuitModel, Edit } from "./types.js"

const FRAME_PROPS = ["pcbX", "pcbY", "pcbRotation"] as const
/** An instance's tag is its sheet's import name, capitalised; a built-in part's is not. */
const INSTANCE_TAG = /^[A-Z]/

const numberOf = (value: unknown): number | undefined => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN
  return Number.isFinite(n) ? n : undefined
}

/** The edits that may move an instance: setProps of pcbX, pcbY or pcbRotation on an element with an instance's tag. */
export function frameEdits(model: CircuitModel, edits: readonly Edit[]): Extract<Edit, { kind: "setProps" }>[] {
  const tags = new Map(model.parts.map((part) => [part.name, part.tag]))
  return edits.flatMap((edit) =>
    edit.kind === "setProps" && INSTANCE_TAG.test(tags.get(edit.part) ?? "") && FRAME_PROPS.some((prop) => prop in edit.props) ? [edit] : [],
  )
}

/** The instance moves the edits make, against the built design before them. */
export function movesOf(design: Design, edits: readonly Extract<Edit, { kind: "setProps" }>[]): InstanceMove[] {
  const instances = design.circuit.instances ?? []
  return edits.flatMap((edit) => {
    const instance = instances.find((one) => one.path === edit.part)
    if (!instance) return []
    const was: Frame = instance.pcb ?? { x: 0, y: 0, rotation: 0 }
    const props = edit.props as Record<string, unknown>
    const to = { x: numberOf(props["pcbX"]) ?? was.x, y: numberOf(props["pcbY"]) ?? was.y, rotation: numberOf(props["pcbRotation"]) ?? was.rotation }
    return [{ instance: instance.path, to }]
  })
}

export interface MovedCopper {
  changes: FileChange[]
  /** "CH3's copper went with it: 4 tracks; 1 track that left it was removed (now unrouted)", or none. */
  note?: string
}

/** The layout change for instance moves on circuit `file`, from its design before the moves (built when not given). */
export async function movedCopper(
  root: string,
  file: string,
  moves: (design: Design) => InstanceMove[],
  source: { design?: Design; engine?: DesignSource },
  resolve: (file: string) => string,
): Promise<MovedCopper> {
  if (!file.endsWith(".circuit.tsx")) return { changes: [] }
  const layoutFile = layoutPathFor(file)
  const before = await readIfThere(resolve(layoutFile))
  if (before === undefined) return { changes: [] }
  const doc = readLayoutText(before, layoutFile)
  if (doc.records.length === 0) return { changes: [] }
  const design = source.design ?? (await buildWith(root, file, source.engine))
  const asked = moves(design)
  if (asked.length === 0) return { changes: [] }
  const result = carriedCopper(design, doc, asked)
  if (result.carried === 0 && result.removed === 0) return result.notes.length > 0 ? { changes: [], note: result.notes.join("; ") } : { changes: [] }
  const after = serializeLayout(result.doc)
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
  const names = asked.map((move) => move.instance).join(", ")
  const parts = [
    ...(result.carried > 0 ? [`${plural(result.carried, "track or via")} went with ${names}`] : []),
    ...(result.removed > 0 ? [`${plural(result.removed, "track or via")} that left ${names} ${result.removed === 1 ? "was" : "were"} removed (now unrouted)`] : []),
    ...result.notes,
  ]
  return { changes: after === before ? [] : [{ file: layoutFile, before, after }], note: `Copper: ${parts.join("; ")}` }
}
