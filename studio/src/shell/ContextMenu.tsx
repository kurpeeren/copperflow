import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { Point } from "../pcb/geometry"
import { contextShape, contextSize, placeMenu, type ContextEntry, type ContextItem, type Size } from "./context-menu"
import { useKeyHold } from "./key-gate"
import { MenuItemButton, useCloseOnOutsidePress } from "./menu-parts"
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

/** Closes when the window changes size. */
function useCloseOnResize(onClose: () => void): void {
  useEffect(() => {
    window.addEventListener("resize", onClose)
    return () => window.removeEventListener("resize", onClose)
  }, [onClose])
}

const itemOf = (menu: HTMLElement | null, element: Element | null): number | null => {
  const node = element instanceof HTMLElement && menu?.contains(element) ? element.closest<HTMLElement>("[data-item]") : null
  return node ? Number(node.dataset.item) : null
}

/** The right-click menu: the menu bar's dropdown at the pointer, kept inside the window, with the same keys. */
export function ContextMenu({ entries, at, onRun, onClose }: Props) {
  const menu = useRef<HTMLUListElement>(null)
  const shape = useMemo(() => contextShape(entries), [entries])
  // The first position uses an estimate of the size; once drawn, the menu is measured and placed again.
  const [measured, setMeasured] = useState<Size | null>(null)
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect()
    if (box) setMeasured({ width: box.width, height: box.height })
  }, [entries])
  const place = useMemo(() => placeMenu(at, measured ?? contextSize(entries), { width: window.innerWidth, height: window.innerHeight }), [at, entries, measured])
  // The menu holds every key while it is open, so none reaches the canvas behind it.
  useKeyHold(true, (event) => {
    const at = itemOf(menu.current, document.activeElement)
    const next = menuKey(event.key, at === null ? null : { menu: 0, item: at }, 0, [shape], { alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey })
    if (!next) return
    if (next.preventDefault) event.preventDefault()
    if (next.open === null) return onClose()
    if (next.focus !== "keep" && next.focus.item !== null) menu.current?.querySelector<HTMLElement>(`[data-item="${next.focus.item}"]`)?.focus()
  })
  useCloseOnOutsidePress(true, menu, onClose)
  useCloseOnResize(onClose)
  return (
    <ul className="menu-dropdown context-menu" role="menu" aria-label="Context menu" ref={menu} onContextMenu={(event) => event.preventDefault()} style={{ left: place.x, top: place.y }}>
      {entries.map((entry, i) =>
        entry === "separator" ? (
          <li key={`sep${i}`} className="menu-separator" role="separator" />
        ) : (
          <li key={entry.label} role="none">
            <MenuItemButton
              label={entry.label}
              {...(entry.shortcut ? { shortcut: entry.shortcut } : {})}
              index={i}
              enabled={!entry.pending}
              {...(entry.pending ? { reason: entry.pending } : {})}
              onActivate={() => {
                onClose()
                onRun(entry)
              }}
            />
          </li>
        ),
      )}
    </ul>
  )
}
