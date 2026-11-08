import { useLayoutEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { blurAfterPointerClick } from "./focus"
import { slotEventStops } from "./slot-events"

export const VIEW_SLOT_ID = "toolbar-view-slot"

const STOPS = slotEventStops()

/**
 * Shows the open canvas's own tools (snap, layers, Keep these positions) in the toolbar's right side. The pointer,
 * mouse, wheel and context-menu events stop at this root, so none reaches the canvas the portal was rendered from.
 */
export function ViewTools({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => setSlot(document.getElementById(VIEW_SLOT_ID)), [])
  if (!slot) return null
  return createPortal(
    <div className="canvas-tools" {...STOPS} onClick={blurAfterPointerClick}>
      {children}
    </div>,
    slot,
  )
}
