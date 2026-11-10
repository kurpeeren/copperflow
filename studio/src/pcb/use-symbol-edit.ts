// The sheet symbol's own handles on the parent page: with the symbol selected, a press on a port's pin where it meets
// the box takes the pin, and a press on the box's lower right corner takes the corner; the release writes the sheet
// file (sheet-symbol-edit.ts). The pin's outer end stays the wire tool's, as on every part.
import { useMemo, useRef, useState } from "react"
import type { Actions } from "../App"
import type { Design } from "../api"
import type { Selection } from "../selection"
import type { Camera, Point } from "./geometry"
import type { Press } from "./press"
import { dropCorner, dropPin, handleAt, symbolHandles, type SymbolHandle } from "./sheet-symbol-edit"

/** How near a handle a press must be, in CSS pixels. */
const HANDLE_REACH_PX = 6

interface Input {
  design: Design
  selection: Selection
  camera: Camera | undefined
  actions: Actions
}

export function useSymbolEdit({ design, selection, camera, actions }: Input) {
  const handles = useMemo(() => symbolHandles(design, selection.names), [design, selection.names])
  const [held, setHeld] = useState<SymbolHandle>()
  const heldRef = useRef<SymbolHandle | undefined>(undefined)
  const take = (handle: SymbolHandle | undefined) => {
    heldRef.current = handle
    setHeld(handle)
  }
  const press = (event: Press, world: Point): boolean => {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || !camera || handles.length === 0) return false
    const handle = handleAt(handles, world, HANDLE_REACH_PX / camera.scale)
    take(handle)
    return handle !== undefined
  }
  const release = (world: Point): void => {
    const handle = heldRef.current
    if (!handle) return
    take(undefined)
    const change = handle.kind === "pin" ? dropPin(design, handle, world) : dropCorner(design, handle, world)
    if ("message" in change) return actions.notify(change.message)
    void actions.editFile(change.file, change.edits, change.summary)
  }
  const hint = held === undefined ? undefined : held.kind === "pin" ? `Drop ${held.port} on any side of ${held.instance}'s box; the release writes its side and order in ${held.file}.` : `Drop the corner to size ${held.instance}'s box; the release writes width and height in ${held.file}.`
  return { press, release, hint, holding: held !== undefined }
}
