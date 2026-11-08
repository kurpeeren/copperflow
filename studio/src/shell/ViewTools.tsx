import { useLayoutEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

export const VIEW_SLOT_ID = "toolbar-view-slot"

/** Shows the open canvas's own tools (snap, layers, Keep these positions) in the toolbar's right side. */
export function ViewTools({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => setSlot(document.getElementById(VIEW_SLOT_ID)), [])
  return slot ? createPortal(children, slot) : null
}
