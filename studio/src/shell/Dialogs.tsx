import { useEffect, useRef, type ReactNode, type RefObject } from "react"
import { CloseIcon } from "../icons"
import { dialogKey, trapStep } from "./dialog-keys"
import { useKeyHold } from "./key-gate"
import { shortcutList } from "./menus"

export type DialogName = "keys" | "about"

const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"

/** While open, the dialog holds every key: Esc closes it, Tab goes round its controls, the rest never reach the canvas. */
function useDialogKeys(box: RefObject<HTMLElement | null>, onClose: () => void): void {
  useKeyHold(true, (event) => {
    const kind = dialogKey(event.key)
    if (kind === "hold") return
    event.preventDefault()
    if (kind === "close") return onClose()
    const controls = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    const next = trapStep(controls.indexOf(document.activeElement as HTMLElement), controls.length, event.shiftKey)
    ;(controls[next] ?? box.current)?.focus()
  })
}

function Dialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const box = useRef<HTMLElement>(null)
  // Focus moves into the dialog on open and goes back to what had it on close.
  useEffect(() => {
    const before = document.activeElement
    const first = box.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? box.current)?.focus()
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus()
    }
  }, [])
  useDialogKeys(box, onClose)
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
