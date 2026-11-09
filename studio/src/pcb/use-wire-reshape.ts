// The schematic's wire shapes on their way to the code: the edit a drag or a double click on a corner handle sends
// (wire-reshape.ts), each new shape drawn until a build that started after it was sent has finished, and the selection
// handed to the new trace's wire when the wire reshaped was one Studio drew on its own.
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react"
import type { CircuitData, Design } from "../api"
import type { Actions } from "../App"
import type { SelectionChange } from "../selection"
import type { Point } from "./geometry"
import type { WireLine } from "./wire-hit"
import { cornerDrop, reshapeBlocker, sentBlocker, shapesBuilt, wireReshape, type SentShape, type WireReshape } from "./wire-reshape"

export interface ReshapeInput {
  design: Design
  circuit: CircuitData
  actions: Actions
  locked: ReadonlySet<string>
  /** When the build behind the shown design started (ms). */
  builtFrom: number
  onSelect(change: SelectionChange): void
}

type Sent = SentShape & WireLine & { sentAt: number }

/**
 * Once a build that includes sent shapes arrives, they are no longer drawn, and a wire Studio drew on its own that is
 * still selected passes its selection to the new trace's wire (wire-reshape.ts shapesBuilt). This runs before App's
 * own pruning of the selection after the build, which then keeps the new wire.
 */
function useBuiltShapes(sent: readonly Sent[], setSent: Dispatch<SetStateAction<Sent[]>>, { design, builtFrom, onSelect }: ReshapeInput): void {
  useEffect(() => {
    const { waiting, follow } = shapesBuilt(sent, builtFrom, new Set(design.schematic.wires.map((wire) => wire.id)))
    if (waiting === sent) return
    setSent((list) => list.filter((shape) => shape.sentAt > builtFrom))
    onSelect(follow)
  }, [sent, setSent, design, builtFrom, onSelect])
}

/**
 * Sends a new shape as one history entry and draws it until its build; a refusal is told, a shape equal to the one
 * shown sends nothing. A drag and a double click work from the shape shown: a shape still waiting for its build when
 * there is one, so the double click's corner and the "unchanged" check match what is on the sheet.
 */
export function useWireReshape(input: ReshapeInput) {
  const { design, circuit, actions, locked, builtFrom } = input
  const [sent, setSent] = useState<Sent[]>([])
  useBuiltShapes(sent, setSent, input)
  const pending = useMemo<WireLine[]>(() => sent.filter((shape) => shape.sentAt > builtFrom).map(({ id, points }) => ({ id, points })), [sent, builtFrom])
  const blocker = useCallback((id: string) => sentBlocker(sent, id) ?? reshapeBlocker(design, circuit, id, locked), [sent, design, circuit, locked])
  const send = useCallback(
    (id: string, result: WireReshape) => {
      if ("blocked" in result) return actions.notify(result.blocked)
      if (result.edits.length === 0) return
      const { edits, summary, ...drawn } = result
      const shape: Sent = { id, ...drawn, sentAt: Date.now() }
      setSent((list) => [...list.filter((other) => other.id !== id), shape])
      void actions.edit(edits, summary).then((ok) => ok || setSent((list) => list.filter((other) => other !== shape)))
    },
    [actions],
  )
  const shownOf = useCallback((id: string) => pending.find((shape) => shape.id === id)?.points, [pending])
  const commit = useCallback((id: string, path: readonly Point[]) => send(id, wireReshape(design, circuit, id, path, locked, shownOf(id))), [send, design, circuit, locked, shownOf])
  const dropCorner = useCallback(
    (id: string, index: number) => {
      const waiting = sentBlocker(sent, id)
      send(id, waiting ? { blocked: waiting } : cornerDrop(design, circuit, id, index, locked, shownOf(id)))
    },
    [send, sent, design, circuit, locked, shownOf],
  )
  return { pending, blocker, commit, dropCorner }
}
