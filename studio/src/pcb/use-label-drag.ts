// What the schematic needs to drag net labels and ground or power symbols: the pure label logic bound to
// the design and the actions, and the labels drawn at their new places while their edits wait for the build.
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

type Sent = MovingLabel & { sentAt: number }

/** Every label move sent, each kept drawn until a build that started after it was sent has finished; a newer move of a label replaces its older one. */
export function useLabelDrag({ design, circuit, actions, builtFrom }: Input): { tools: LabelTools; pending: MovingLabel[] } {
  const [sent, setSent] = useState<Sent[]>([])
  useEffect(() => setSent((list) => (list.every((m) => m.sentAt > builtFrom) ? list : list.filter((m) => m.sentAt > builtFrom))), [builtFrom])
  const locked = useMemo(() => new Set(circuit.annotations.locks.map((l) => l.part)), [circuit])
  const tools: LabelTools = {
    at: (world) => labelAt(design, world),
    blocker: (id) => labelBlocker(design, circuit, id, locked),
    commit: (label, drop) => {
      const edits = labelDragEdits(design, circuit, label.id, drop, locked)
      if (!Array.isArray(edits)) return actions.notify(edits.blocked)
      const preview = labelPreview(design, label.id, drop)
      if (edits.length === 0 || !preview) return
      const move = { id: label.id, ...preview, sentAt: Date.now() }
      setSent((list) => [...list.filter((m) => m.id !== label.id), move])
      void actions.edit(edits, `Move ${label.text} label`).then((ok) => ok || setSent((list) => list.filter((m) => m !== move)))
    },
  }
  const pending = useMemo(() => sent.filter((m) => m.sentAt > builtFrom), [sent, builtFrom])
  return { tools, pending }
}

/** The label at `drop` while it is dragged, as it would be drawn; undefined when nothing is dragged. */
export function useDraggedLabel(design: Design, dragged: { id: string; at: Point } | undefined): MovingLabel | undefined {
  return useMemo(() => {
    const preview = dragged && labelPreview(design, dragged.id, dragged.at)
    return dragged && preview ? { id: dragged.id, ...preview } : undefined
  }, [design, dragged])
}
