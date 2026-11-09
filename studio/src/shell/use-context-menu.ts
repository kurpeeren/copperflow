// The state of the right-click menu: what was clicked, where, and what each item does. A right click on a part or a
// wire first changes the selection (context-menu.ts), then the items act on it through the one command path.
import { useCallback, useMemo, useState } from "react"
import type { CircuitData } from "../api"
import { canonicalNet, type Highlight } from "../pcb/highlight"
import type { Point } from "../pcb/geometry"
import { wireReasons, type WireReasons } from "../pcb/wire-actions"
import type { ContextTarget } from "../pcb/press"
import type { Design } from "../../../src/engine/design.js"
import type { Selection, SelectionChange } from "../selection"
import { allLocked, contextItems, contextSelection, WIRE_IN_GROUP, type ContextEntry, type ContextItem } from "./context-menu"
import type { CommandId } from "./menus"
import { targetActions } from "./target-actions"

/** A right click that is being answered: what it was on, where, and how to rename the net of a label. */
interface Request {
  target: ContextTarget
  at: Point
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
  show(target: ContextTarget, at: Point): void
  close(): void
  runItem(item: ContextItem): void
}

/**
 * On a wire selected alone, why its Delete and Remove corners cannot run; on one selected with other things, Delete acts
 * on all of them and Remove corners waits for the wire alone.
 */
function wireMenuReasons(id: string, after: Selection, design: Design | undefined, circuit: CircuitData | undefined, locked: ReadonlySet<string>): WireReasons | undefined {
  if (after.total > 1) return WIRE_IN_GROUP
  return design && circuit ? wireReasons(design, circuit, id, locked) : undefined
}

/** Whether every selected track and via is locked, so the menu offers Unlock. */
function copperAllLocked(design: Design | undefined, ids: readonly string[]): boolean {
  const items = [...(design?.pcb.tracks ?? []), ...(design?.pcb.vias ?? [])].filter((item) => ids.includes(item.id))
  return items.length > 0 && items.every((item) => item.locked)
}

export function useContextMenu(input: Input): ContextMenuState {
  const { circuit, design, selection, onSelect, run, openProperties, onHighlight } = input
  const [request, setRequest] = useState<Request | null>(null)
  const show = useCallback(
    (target: ContextTarget, at: Point) => {
      onSelect((current) => contextSelection(current, target))
      setRequest({ target, at })
    },
    [onSelect],
  )
  const close = useCallback(() => setRequest(null), [])
  const open = useMemo(() => {
    if (!request) return null
    const locked = new Set(circuit?.annotations.locks.map((lock) => lock.part))
    // The selection the click leaves, which the items act on.
    const after = contextSelection(selection, request.target)
    const { target } = request
    const wire = target.kind === "wire" ? wireMenuReasons(target.id, after, design, circuit, locked) : undefined
    const copperLocked = target.kind === "copper" && copperAllLocked(design, after.copper)
    return { entries: contextItems(target, { allLocked: allLocked(after.names, locked), selected: after.size, wire, copperLocked }), at: request.at }
  }, [request, circuit, design, selection])
  const runItem = useCallback(
    (item: ContextItem) => {
      if (item.command) return run(item.command)
      if (item.special === "properties") return openProperties()
      if (item.special === "rename" && request?.target.kind === "label") return void targetActions.send({ kind: "renameLabel", labelId: request.target.label.id })
      if (item.special === "highlightNet" && request?.target.kind === "label" && design) onHighlight([canonicalNet(design.circuit.nets, request.target.label.net)])
    },
    [run, openProperties, onHighlight, request, design],
  )
  return { open, close, show, runItem }
}
