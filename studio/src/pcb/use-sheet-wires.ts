// The schematic's wires on the canvas: which one is under the pointer at this zoom (wire-hit.ts), the selected one's
// line for its handles and the keyboard menu, the selected wire's commands, and reshaping (use-wire-reshape.ts): a
// drag through the gestures, a double click on a corner handle here. Delete and Highlight net are the part keys'
// commands, which call `keys` for a wire; Remove corners is the schematic's own command. What each command writes, or
// why it refuses, is wire-actions.ts. A wire whose new shape waits for its build is drawn, hit and dragged in that shape.
import { useCallback, useMemo } from "react"
import type { CircuitData, Design } from "../api"
import type { Actions } from "../App"
import type { Selection, SelectionChange } from "../selection"
import type { WireCommand } from "../shell/command-owners"
import { useCommands } from "../shell/commands"
import type { Camera, Point } from "./geometry"
import type { GestureWires } from "./gestures"
import type { PickContext } from "./pick"
import { cornerRemoval, wireNet, wireRemoval, type WireEdit } from "./wire-actions"
import { handleUnder, withShapes } from "./wire-drag"
import { wireAt, wireReachPx, type WireLine } from "./wire-hit"
import { useWireReshape } from "./use-wire-reshape"

/** The selected wire's corner handles, for a double click (gestures.ts doubleClickAction). */
export interface SheetCorners {
  /** The handle under `world`, when a pick made with `picking` may take a wire. */
  at(world: Point, picking: PickContext): { id: string; index: number } | undefined
  /** Removes corner `index` of the wire's shape as shown, in one history entry. */
  drop(id: string, index: number): void
}

/** What the part keys ask of a selected wire: its net for Highlight net, and its removal for Delete. */
export interface WireKeys {
  net(id: string): string | undefined
  remove(id: string): void
}

interface SheetWiresInput {
  design: Design
  circuit: CircuitData
  actions: Actions
  locked: ReadonlySet<string>
  camera: Camera | undefined
  selection: Selection
  onSelect(change: SelectionChange): void
  /** When the build behind the shown design started (ms). */
  builtFrom: number
  /** The W tool is wiring or drawing: presses are its own, so a press on a wire that reaches the gestures only selects it. */
  wiring: boolean
}

/** Sends a wire command's edit as one history entry, or says why it cannot run; resolves to whether it was written. */
async function sendWireEdit(result: WireEdit, actions: Actions): Promise<boolean> {
  if ("blocked" in result) {
    actions.notify(result.blocked)
    return false
  }
  return actions.edit(result.edits, result.summary)
}

/** The selected wire's Delete and Highlight net for the part keys, and Remove corners on the command bus. */
function useWireCommands({ design, circuit, actions, locked, selection, onSelect }: SheetWiresInput): WireKeys {
  const remove = useCallback(
    (id: string) =>
      void sendWireEdit(wireRemoval(design, circuit, id, locked), actions).then((ok) => ok && onSelect((current) => (current.wire === id ? current.clear() : current))),
    [design, circuit, locked, actions, onSelect],
  )
  const net = useCallback((id: string) => wireNet(design, id), [design])
  const removeCorners = () => {
    if (selection.wire === undefined) return actions.notify("Select a wire first.")
    void sendWireEdit(cornerRemoval(design, circuit, selection.wire, locked), actions)
  }
  useCommands({ removeCorners } satisfies Record<WireCommand, () => void>)
  return useMemo(() => ({ net, remove }), [net, remove])
}

export function useSheetWires(input: SheetWiresInput) {
  const { design, camera, selection, wiring } = input
  const { pending, blocker, commit, dropCorner } = useWireReshape(input)
  const wires = useMemo(() => withShapes(design.schematic.wires, pending), [design.schematic.wires, pending])
  const lineOf = useCallback((id: string | undefined): WireLine | undefined => (id === undefined ? undefined : wires.find((wire) => wire.id === id)), [wires])
  const hits = useMemo<GestureWires>(() => {
    const at = (world: Point) => (camera ? wireAt(wires, world, wireReachPx(camera.scale) / camera.scale) : undefined)
    return wiring ? { at } : { at, drag: { points: (id) => lineOf(id)?.points, blocker, commit } }
  }, [wires, camera, lineOf, blocker, commit, wiring])
  /** The selected wire's corner handles for a double click: the one under a point, and removing a corner. */
  const corners: SheetCorners = {
    at: (world, picking) => (camera ? handleUnder(hits.drag, picking, world, camera.scale) : undefined),
    drop: dropCorner,
  }
  const selected = useMemo(() => lineOf(selection.wire), [lineOf, selection.wire])
  const keys = useWireCommands(input)
  return { hits, selected, lineOf, keys, pending, corners }
}
