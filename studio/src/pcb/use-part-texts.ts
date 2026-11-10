// What a canvas needs to pick, drag and nudge its parts' texts (the names and values on the schematic, the designators
// on the PCB): the pure part-text.ts bound to the design and the actions, and the moves drawn at their new places while
// their edits wait for the build. A move is one set_props edit, so one history entry; quick arrow presses are merged
// into as few moves as the edits in flight allow (text-keys.ts).
import { useEffect, useMemo, useRef, useState } from "react"
import type { CircuitData, Design } from "../api"
import type { Actions } from "../App"
import type { Point } from "./geometry"
import type { Gesture, GestureTexts } from "./gestures"
import { textBlocker, textMoveEdits, textsWithMoves, textUnder, TEXT_NAMES, viewTexts, type PartText, type TextMove } from "./part-text"
import type { View } from "./positions"
import { textKeys } from "./text-keys"

interface Input {
  view: View
  design: Design
  circuit: CircuitData
  actions: Actions
  locked: ReadonlySet<string>
  /** When the build behind the shown design started (ms). */
  builtFrom: number
  /** Whether a part's text is drawn, so it may be picked: on the PCB, whether its side's silkscreen layer is shown. */
  drawn?(part: string): boolean
}

type Sent = TextMove & { sentAt: number }

export interface PartTexts {
  tools: GestureTexts
  /** The texts with the moves sent and waiting for their build in place. */
  placed: readonly PartText[]
  /** The moves sent and waiting for their build. */
  pending: readonly TextMove[]
  /** Moves the text by `by` from where it is drawn now (the arrow keys). */
  nudge(id: string, by: Point): void
}

/** The text being dragged, where the drag puts it; none while the drag has not moved or may not move. */
function draggedMove(gesture: Gesture | undefined): TextMove | undefined {
  return gesture?.kind === "text" && gesture.moved && !gesture.blocker ? { id: gesture.id, at: gesture.at } : undefined
}

/** Every text move sent, each kept drawn until a build that started after it was sent has finished; a newer move of a text replaces its older one. */
export function usePartTexts({ view, design, circuit, actions, locked, builtFrom, drawn }: Input): PartTexts {
  const [sent, setSent] = useState<Sent[]>([])
  useEffect(() => setSent((list) => (list.every((m) => m.sentAt > builtFrom) ? list : list.filter((m) => m.sentAt > builtFrom))), [builtFrom])
  const texts = useMemo(() => viewTexts(view, design), [view, design])
  const pending = useMemo(() => sent.filter((m) => m.sentAt > builtFrom), [sent, builtFrom])
  const placed = useMemo(() => textsWithMoves(texts, pending), [texts, pending])
  const show = (id: string, at: Point): Sent => {
    const move: Sent = { id, at, sentAt: Date.now() }
    setSent((list) => [...list.filter((m) => m.id !== id), move])
    return move
  }
  /** Writes the text's middle at `at`; resolves whether it was written (nothing to write counts as written). */
  const write = async (text: PartText, at: Point): Promise<boolean> => {
    const blocked = textBlocker(circuit, locked, text.id)
    if (blocked) {
      actions.notify(blocked)
      return false
    }
    const edits = textMoveEdits(text, at)
    if (edits.length === 0) return true
    const move = show(text.id, at)
    const ok = await actions.edit(edits, `Move ${text.part} ${TEXT_NAMES[text.prop]?.toLowerCase() ?? text.prop}`)
    if (!ok) setSent((list) => list.filter((m) => m !== move))
    return ok
  }
  const commit = (id: string, at: Point) => {
    const text = placed.find((t) => t.id === id)
    if (text) void write(text, at)
  }
  // The key bursts outlive renders; each send uses the latest write.
  const latestWrite = useRef(write)
  latestWrite.current = write
  const [keys] = useState(() => textKeys((text, at) => latestWrite.current(text, at)))
  const tools: GestureTexts = {
    at: (world) => textUnder(drawn ? placed.filter((t) => drawn(t.part)) : placed, world)?.id,
    position: (id) => placed.find((t) => t.id === id)?.at,
    blocker: (id) => textBlocker(circuit, locked, id),
    commit,
  }
  const nudge = (id: string, by: Point) => {
    const at = keys.press(design, (wanted) => placed.find((t) => t.id === wanted), id, by)
    if (at && textBlocker(circuit, locked, id) === null) show(id, at)
  }
  return { tools, placed, pending, nudge }
}

/** The moves to draw (the text being dragged, then those sent and waiting) and the texts as they are then drawn. */
export function useShownTexts(texts: PartTexts, gesture: Gesture | undefined): { moves: readonly TextMove[]; shown: readonly PartText[] } {
  const { placed, pending } = texts
  return useMemo(() => {
    const dragged = draggedMove(gesture)
    const moves = dragged ? [dragged, ...pending.filter((m) => m.id !== dragged.id)] : pending
    return { moves, shown: dragged ? textsWithMoves(placed, [dragged]) : placed }
  }, [gesture, placed, pending])
}
