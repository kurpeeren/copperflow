import { useEffect, type ReactNode } from "react"
import { CloseIcon } from "../icons"
import { shortcutList } from "./menus"

export type DialogName = "keys" | "about"

function Dialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
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
      <section className="dialog" role="dialog" aria-modal="true" aria-label={title}>
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
