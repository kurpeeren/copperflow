// What the schematic needs to drag net labels and ground or power symbols: the pure label logic bound to
// the design and the actions, and the label drawn at its new place while its edit waits for the build.
import { useEffect, useMemo, useState } from "react"
import type { CircuitData, Design } from "../api"
import type { Actions } from "../App"
import type { NetLabel } from "../../../src/engine/schematic.js"
import type { Point } from "./geometry"
import { labelAt, labelBlocker, labelDragEdits, labelPreview, type LabelPreview } from "./label-drag"

/** What a canvas gesture asks of labels. */
export interface LabelTools {
  /** The label under the point, if any. */
  at(world: Point): NetLabel | undefined
  /** Why the label may not be dragged, or null. */
  blocker(id: string): string | null
  /** Writes the move to `drop`. */
  commit(label: NetLabel, drop: Point): void
}

/** A label drawn away from where the design has it: being dragged, or moved and waiting for its build. */
export interface MovingLabel extends LabelPreview {
  id: string
}

interface Input {
  design: Design
  circuit: CircuitData
  actions: Actions
  /** When the build behind the shown design started (ms). */
  builtFrom: number
}

/** The last label move sent, kept drawn until a build that started after it was sent has finished. */
export function useLabelDrag({ design, circuit, actions, builtFrom }: Input): { tools: LabelTools; pending: MovingLabel | undefined } {
  const [sent, setSent] = useState<MovingLabel & { sentAt: number }>()
  useEffect(() => setSent((current) => (current && current.sentAt > builtFrom ? current : undefined)), [builtFrom])
  const tools: LabelTools = {
    at: (world) => labelAt(design, world),
    blocker: (id) => labelBlocker(design, circuit, id),
    commit: (label, drop) => {
      const edits = labelDragEdits(design, circuit, label.id, drop)
      if (!Array.isArray(edits)) return actions.notify(edits.blocked)
      const preview = labelPreview(design, label.id, drop)
      if (edits.length === 0 || !preview) return
      const move = { id: label.id, ...preview, sentAt: Date.now() }
      setSent(move)
      void actions.edit(edits, `Move ${label.text} label`).then((ok) => ok || setSent((current) => (current === move ? undefined : current)))
    },
  }
  const pending = useMemo(() => (sent && sent.sentAt > builtFrom ? sent : undefined), [sent, builtFrom])
  return { tools, pending }
}

/** The label at `drop` while it is dragged, as it would be drawn; undefined when nothing is dragged. */
export function useDraggedLabel(design: Design, dragged: { id: string; at: Point } | undefined): MovingLabel | undefined {
  return useMemo(() => {
    const preview = dragged && labelPreview(design, dragged.id, dragged.at)
    return dragged && preview ? { id: dragged.id, ...preview } : undefined
  }, [design, dragged])
}
