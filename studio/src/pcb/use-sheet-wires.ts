// The schematic's wires on the canvas: which one is under the pointer at this zoom (wire-hit.ts), the lines the
// selection box looks at, the selected wires' lines (drawn red; a wire selected alone also gets its handles and the
// keyboard menu), the wire commands, and reshaping (use-wire-reshape.ts): a drag through the gestures, a double click on
// a corner handle here. Delete and Highlight net are the part keys' commands, which call `keys` for the wires; Remove
// corners is the schematic's own command. What each command writes, or why it refuses, is wire-actions.ts. A wire whose
// new shape waits for its build is drawn, hit and dragged in that shape.
import { useCallback, useMemo } from "react"
import type { CircuitData, Design } from "../api"
import type { Actions } from "../App"
import type { Selection, SelectionChange } from "../selection"
import type { WireCommand } from "../shell/command-owners"
import { useCommands } from "../shell/commands"
import type { Camera, Point } from "./geometry"
import type { GestureWires } from "./gestures"
import type { PickContext } from "./pick"
import type { RemoveWires } from "./delete-plan"
import { cornerRemoval, wireNet, wiresRemoval, type WireEdit } from "./wire-actions"
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

/** What the part keys ask of the selected wires: a wire's net for Highlight net, and their removal for Delete (delete-plan.ts). */
export interface WireKeys {
  net(id: string): string | undefined
  removal: RemoveWires
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

/** The selected wires' Delete and Highlight net for the part keys, and Remove corners (on a wire selected alone) on the command bus. */
function useWireCommands({ design, circuit, actions, locked, selection }: SheetWiresInput): WireKeys {
  const removal = useCallback<RemoveWires>((ids, parts) => wiresRemoval(design, circuit, ids, parts, locked), [design, circuit, locked])
  const net = useCallback((id: string) => wireNet(design, id), [design])
  const removeCorners = () => {
    const wire = selection.soleWire
    if (wire === undefined) return actions.notify("Select one wire first.")
    void sendWireEdit(cornerRemoval(design, circuit, wire, locked), actions)
  }
  useCommands({ removeCorners } satisfies Record<WireCommand, () => void>)
  return useMemo(() => ({ net, removal }), [net, removal])
}

export function useSheetWires(input: SheetWiresInput) {
  const { design, camera, selection, wiring } = input
  const { pending, blocker, commit, dropCorner } = useWireReshape(input)
  const wires = useMemo(() => withShapes(design.schematic.wires, pending), [design.schematic.wires, pending])
  const lineOf = useCallback((id: string | undefined): WireLine | undefined => (id === undefined ? undefined : wires.find((wire) => wire.id === id)), [wires])
  const hits = useMemo<GestureWires>(() => {
    const at = (world: Point) => (camera ? wireAt(wires, world, wireReachPx(camera.scale) / camera.scale) : undefined)
    return wiring ? { at, lines: wires } : { at, lines: wires, drag: { points: (id) => lineOf(id)?.points, blocker, commit } }
  }, [wires, camera, lineOf, blocker, commit, wiring])
  /** The selected wire's corner handles for a double click: the one under a point, and removing a corner. */
  const corners: SheetCorners = {
    at: (world, picking) => (camera ? handleUnder(hits.drag, picking, world, camera.scale) : undefined),
    drop: dropCorner,
  }
  const selected = useMemo(() => lineOf(selection.soleWire), [lineOf, selection.soleWire])
  // Shift+F10 opens the menu of the wire picked last when no part is selected (key-menu.ts).
  const menuWire = useMemo(() => (selection.size === 0 ? lineOf(selection.wires.at(-1)) : undefined), [lineOf, selection])
  const keys = useWireCommands(input)
  return { hits, selected, menuWire, lineOf, keys, pending, corners }
}
