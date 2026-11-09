// The pieces the menu bar's dropdowns and the context menu share: the item button and the outside-press close.
import { useEffect, type RefObject } from "react"
import { blurButton, isPointerClick } from "./focus"

interface ItemProps {
  label: string
  shortcut?: string
  /** The menu's index in the bar; the context menu has none. */
  menu?: number
  index: number
  enabled: boolean
  /** Why the item cannot run, shown as its title. */
  reason?: string
  /** A click on an enabled item; `keyboard` when it was Enter or Space. Disabled items take the focus but do nothing. */
  onActivate(keyboard: boolean): void
}

export function MenuItemButton({ label, shortcut, menu, index, enabled, reason, onActivate }: ItemProps) {
  return (
    <button
      role="menuitem"
      className="menu-item"
      {...(menu === undefined ? {} : { "data-menu": menu })}
      data-item={index}
      tabIndex={-1}
      aria-disabled={enabled ? undefined : true}
      title={reason}
      onClick={(event) => {
        const keyboard = !isPointerClick(event)
        if (!keyboard) blurButton(event)
        if (enabled) onActivate(keyboard)
      }}
    >
      <span>{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  )
}

/** While `active`, a press outside `inside` calls `close`. */
export function useCloseOnOutsidePress(active: boolean, inside: RefObject<HTMLElement | null>, close: () => void): void {
  useEffect(() => {
    if (!active) return
    const onPress = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !inside.current?.contains(event.target)) close()
    }
    window.addEventListener("pointerdown", onPress, true)
    return () => window.removeEventListener("pointerdown", onPress, true)
  }, [active, inside, close])
}
