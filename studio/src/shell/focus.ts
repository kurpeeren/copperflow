// One rule for the focus after a click, everywhere in the chrome: a pointer click gives the focus up, so Space goes
// back to rotating the selected parts; Enter or Space on a focused control clicks with detail 0 and keeps the focus
// there, so the menus, tabs and lists can be walked from the keyboard.

/** True for a pointer click: `detail` counts the presses, and is 0 for a click made with Enter or Space. */
export function isPointerClick(event: { detail: number }): boolean {
  return event.detail > 0
}

/** The controls a click gives the focus up from: buttons, and checkboxes (clicked themselves or through their label). */
const LETS_GO = "button, input[type='checkbox']"

/** Takes the focus from the button or checkbox the event happened in. */
export function blurButton(event: { target: EventTarget | null }): void {
  if (event.target instanceof HTMLElement) event.target.closest<HTMLElement>(LETS_GO)?.blur()
}

/**
 * Whether a click on a control came from the pointer. A label forwards its click to its checkbox with detail 0, as
 * Space does, so for a checkbox the browser's own guess decides too: a checkbox the pointer focused shows no
 * keyboard focus ring (`focusVisible` false).
 */
export function pointerClicked(control: "button" | "checkbox", detail: number, focusVisible: boolean): boolean {
  return detail > 0 || (control === "checkbox" && !focusVisible)
}

/**
 * Whether a closing menu gives the focus back to where it was before it opened: only while the focus is still in the
 * menu or on nothing (the page's body), so a field that an item focused (Properties, a rename) keeps it.
 */
export function returnsFocus(active: Element | null, body: Element | null, menu: { contains(node: Node | null): boolean } | null): boolean {
  return active === null || active === body || (menu?.contains(active) ?? false)
}

/** The rule above, for an onClick handler: put it after the control's own handler, or on the panel around the controls. */
export function blurAfterPointerClick(event: { detail: number; target: EventTarget | null }): void {
  const control = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(LETS_GO) : null
  if (!control) return
  const kind = control instanceof HTMLInputElement ? "checkbox" : "button"
  if (pointerClicked(kind, event.detail, control.matches(":focus-visible"))) control.blur()
}
