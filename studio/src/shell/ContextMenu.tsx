import { useEffect, useMemo, useRef } from "react"
import type { Point } from "../pcb/geometry"
import { blurButton, isPointerClick } from "./focus"
import { contextShape, contextSize, placeMenu, type ContextEntry, type ContextItem } from "./context-menu"
import { useKeyHold } from "./key-gate"
import { menuKey } from "./menu-keys"
import "./shell.css"
import "./context-menu.css"

interface Props {
  entries: readonly ContextEntry[]
  /** Where the pointer was, in client pixels. */
  at: Point
  /** Runs an item; the menu closes first. */
  onRun(item: ContextItem): void
  onClose(): void
}

/** Closes on a press anywhere outside the menu, and when the window changes size. */
function useCloseOutside(menu: React.RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const onPress = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) onClose()
    }
    window.addEventListener("pointerdown", onPress, true)
    window.addEventListener("resize", onClose)
    return () => {
      window.removeEventListener("pointerdown", onPress, true)
      window.removeEventListener("resize", onClose)
    }
  }, [menu, onClose])
}

const itemOf = (menu: HTMLElement | null, element: Element | null): number | null => {
  const node = element instanceof HTMLElement && menu?.contains(element) ? element.closest<HTMLElement>("[data-item]") : null
  return node ? Number(node.dataset.item) : null
}

/** The right-click menu: the menu bar's dropdown at the pointer, kept inside the window, with the same keys. */
export function ContextMenu({ entries, at, onRun, onClose }: Props) {
  const menu = useRef<HTMLUListElement>(null)
  const shape = useMemo(() => contextShape(entries), [entries])
  const place = useMemo(() => placeMenu(at, contextSize(entries), { width: window.innerWidth, height: window.innerHeight }), [at, entries])
  // The menu holds every key while it is open, so none reaches the canvas behind it.
  useKeyHold(true, (event) => {
    const at = itemOf(menu.current, document.activeElement)
    const next = menuKey(event.key, at === null ? null : { menu: 0, item: at }, 0, [shape], { alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey })
    if (!next) return
    if (next.preventDefault) event.preventDefault()
    if (next.open === null) return onClose()
    if (next.focus !== "keep" && next.focus.item !== null) menu.current?.querySelector<HTMLElement>(`[data-item="${next.focus.item}"]`)?.focus()
  })
  useCloseOutside(menu, onClose)
  return (
    <ul className="menu-dropdown context-menu" role="menu" aria-label="Context menu" ref={menu} style={{ left: place.x, top: place.y }}>
      {entries.map((entry, i) =>
        entry === "separator" ? (
          <li key={`sep${i}`} className="menu-separator" role="separator" />
        ) : (
          <li key={entry.label} role="none">
            <button
              role="menuitem"
              className="menu-item"
              data-item={i}
              tabIndex={-1}
              aria-disabled={entry.pending ? true : undefined}
              title={entry.pending}
              onClick={(event) => {
                if (isPointerClick(event)) blurButton(event)
                if (entry.pending) return
                onClose()
                onRun(entry)
              }}
            >
              <span>{entry.label}</span>
              {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
            </button>
          </li>
        ),
      )}
    </ul>
  )
}
