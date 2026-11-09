// One rule for the focus after a click, everywhere in the chrome: a pointer click gives the focus up, so Space goes
// back to rotating the selected parts; Enter or Space on a focused control clicks with detail 0 and keeps the focus
// there, so the menus, tabs and lists can be walked from the keyboard.

/** True for a pointer click: `detail` counts the presses, and is 0 for a click made with Enter or Space. */
export function isPointerClick(event: { detail: number }): boolean {
  return event.detail > 0
}

/** Takes the focus from the button the event happened in. */
export function blurButton(event: { target: EventTarget | null }): void {
  if (event.target instanceof HTMLElement) event.target.closest("button")?.blur()
}

/**
 * Whether a closing menu gives the focus back to where it was before it opened: only while the focus is still in the
 * menu or on nothing (the page's body), so a field that an item focused (Properties, a rename) keeps it.
 */
export function returnsFocus(active: Element | null, body: Element | null, menu: { contains(node: Node | null): boolean } | null): boolean {
  return active === null || active === body || (menu?.contains(active) ?? false)
}

/** The rule above, for an onClick handler: put it after the control's own handler. */
export function blurAfterPointerClick(event: { detail: number; target: EventTarget | null }): void {
  if (isPointerClick(event)) blurButton(event)
}
