import { useEffect, useRef, type ReactNode } from "react"
import { CloseIcon } from "../icons"
import { shortcutList } from "./menus"

export type DialogName = "keys" | "about"

function Dialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const box = useRef<HTMLElement>(null)
  // Focus moves into the dialog on open and goes back to what had it on close.
  useEffect(() => {
    const before = document.activeElement
    const first = box.current?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")
    ;(first ?? box.current)?.focus()
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus()
    }
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onClose])
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={box} tabIndex={-1} className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </section>
    </div>
  )
}

function KeysList() {
  return (
    <table>
      <tbody>
        {shortcutList().map((row) => (
          <tr key={row.keys}>
            <td>
              <kbd>{row.keys}</kbd>
            </td>
            <td>{row.label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Help → Keys and Help → About. */
export function StudioDialog({ name, onClose }: { name: DialogName; onClose(): void }) {
  if (name === "keys") {
    return (
      <Dialog title="Keys" onClose={onClose}>
        <KeysList />
      </Dialog>
    )
  }
  return (
    <Dialog title="About copperflow" onClose={onClose}>
      <p>
        <strong>copperflow</strong> Studio
      </p>
      <p>Design circuits in code with a human and an AI agent editing the same files.</p>
      <p>Apache License 2.0</p>
    </Dialog>
  )
}
