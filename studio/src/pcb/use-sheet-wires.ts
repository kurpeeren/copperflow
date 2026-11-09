// The schematic's wires on the canvas: which one is under the pointer at this zoom (wire-hit.ts), the selected one's
// line for its handles and the keyboard menu, and the selected wire's commands. Delete and Highlight net are the part
// keys' commands, which call `keys` for a wire; Remove corners is the schematic's own command. What each command
// writes, or why it refuses, is wire-actions.ts.
import { useCallback, useMemo } from "react"
import type { CircuitData, Design } from "../api"
import type { Actions } from "../App"
import type { Selection, SelectionChange } from "../selection"
import type { WireCommand } from "../shell/command-owners"
import { useCommands } from "../shell/commands"
import type { Camera } from "./geometry"
import type { GestureWires } from "./gestures"
import { cornerRemoval, wireNet, wireRemoval, type WireEdit } from "./wire-actions"
import { WIRE_REACH_PX, wireAt, type WireLine } from "./wire-hit"

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
  const { design, camera, selection } = input
  const wires = design.schematic.wires
  const hits = useMemo<GestureWires>(() => ({ at: (world) => (camera ? wireAt(wires, world, WIRE_REACH_PX / camera.scale) : undefined) }), [wires, camera])
  const lineOf = useCallback((id: string | undefined): WireLine | undefined => (id === undefined ? undefined : wires.find((wire) => wire.id === id)), [wires])
  const selected = useMemo(() => lineOf(selection.wire), [lineOf, selection.wire])
  const keys = useWireCommands(input)
  return { hits, selected, lineOf, keys }
}
