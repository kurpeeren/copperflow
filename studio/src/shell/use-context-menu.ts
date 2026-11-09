// The state of the right-click menu: what was clicked, where, and what each item does. A right click on a part
// first changes the selection (context-menu.ts), then the items act on it through the one command path.
import { useCallback, useMemo, useState } from "react"
import type { CircuitData } from "../api"
import { canonicalNet, type Highlight } from "../pcb/highlight"
import type { Point } from "../pcb/geometry"
import type { ContextTarget } from "../pcb/press"
import type { Design } from "../../../src/engine/design.js"
import type { Selection, SelectionChange } from "../selection"
import { contextItems, contextSelection, type ContextEntry, type ContextItem } from "./context-menu"
import type { CommandId } from "./menus"

/** A right click that is being answered: what it was on, where, and how to rename the net of a label. */
interface Request {
  target: ContextTarget
  at: Point
  rename?: () => void
}

interface Input {
  circuit: CircuitData | undefined
  design: Design | undefined
  selection: Selection
  onSelect(change: SelectionChange): void
  run(command: CommandId): void
  openProperties(): void
  onHighlight(nets: Highlight): void
}

export interface ContextMenuState {
  /** The open menu's items and place; null when closed. */
  open: { entries: readonly ContextEntry[]; at: Point } | null
  show(target: ContextTarget, at: Point, rename?: () => void): void
  close(): void
  runItem(item: ContextItem): void
}

export function useContextMenu(input: Input): ContextMenuState {
  const { circuit, design, selection, onSelect, run, openProperties, onHighlight } = input
  const [request, setRequest] = useState<Request | null>(null)
  const show = useCallback(
    (target: ContextTarget, at: Point, rename?: () => void) => {
      onSelect((current) => contextSelection(current, target))
      setRequest(rename ? { target, at, rename } : { target, at })
    },
    [onSelect],
  )
  const close = useCallback(() => setRequest(null), [])
  const open = useMemo(() => {
    if (!request) return null
    const locked = new Set(circuit?.annotations.locks.map((lock) => lock.part))
    // The selection the click leaves, which the items act on.
    const after = contextSelection(selection, request.target)
    const allLocked = after.size > 0 && after.names.every((name) => locked.has(name))
    return { entries: contextItems(request.target, { allLocked }), at: request.at }
  }, [request, circuit, selection])
  const runItem = useCallback(
    (item: ContextItem) => {
      if (item.command) return run(item.command)
      if (item.special === "properties") return openProperties()
      if (item.special === "rename") return request?.rename?.()
      if (item.special === "highlightNet" && request?.target.kind === "label" && design) onHighlight([canonicalNet(design.circuit.nets, request.target.label.net)])
    },
    [run, openProperties, onHighlight, request, design],
  )
  return { open, close, show, runItem }
}
