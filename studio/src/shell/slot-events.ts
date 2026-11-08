// The open canvas renders its own controls (snap, layers, Keep these positions) into the toolbar through a portal.
// React passes a portal's events up the React tree, not the page's, so without a stop at the slot a pointer move over
// Snap would reach the canvas's pointer handlers (its hover, the wire tool, the H key's cursor) and a right click
// would lose the browser's menu. These are the events stopped there; clicks, changes and keys go on as usual.

export const SLOT_STOPPED_EVENTS = [
  "onPointerDown",
  "onPointerMove",
  "onPointerUp",
  "onPointerCancel",
  "onMouseDown",
  "onMouseMove",
  "onMouseUp",
  "onDoubleClick",
  "onWheel",
  "onContextMenu",
] as const

export type SlotStoppedEvent = (typeof SLOT_STOPPED_EVENTS)[number]

/** Handlers for the slot's root element that stop each of these events from leaving the slot. */
export function slotEventStops(): Record<SlotStoppedEvent, (event: { stopPropagation(): void }) => void> {
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation()
  return Object.fromEntries(SLOT_STOPPED_EVENTS.map((name) => [name, stop])) as Record<SlotStoppedEvent, typeof stop>
}
