import { useEffect, useRef, type KeyboardEvent } from "react"
import { CloseIcon } from "./icons"
import "./find.css"

interface Props {
  text: string
  /** Changes on every request to focus the field (Ctrl+F, Edit → Find). */
  seq: number
  onText(text: string): void
  onSearch(text: string): void
  onClose(): void
  /** The last search's count ("3 results"), said politely by assistive tech when it changes. */
  status: string
}

/** The canvas area takes the focus back when the box closes. */
function focusCanvas(): void {
  document.getElementById("doc-panel")?.focus()
}

/** The small find box at the canvas's top right: Enter searches, Esc or its close button closes. */
export function FindBox({ text, seq, onText, onSearch, onClose, status }: Props) {
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const focusField = () => {
      field.current?.focus()
      field.current?.select()
    }
    focusField()
    // A menu item run from the keyboard gives the focus back to the menu's title after the command: focus again once it has.
    const later = window.setTimeout(focusField, 0)
    return () => window.clearTimeout(later)
  }, [seq])
  const close = () => {
    onClose()
    focusCanvas()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") onSearch(text)
    else if (event.key === "Escape") close()
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") field.current?.select()
    else return
    event.preventDefault()
    event.stopPropagation()
  }
  return (
    <div className="find-box" role="search">
      <input
        ref={field}
        type="text"
        value={text}
        placeholder="Find a part or a net"
        aria-label="Find a part or a net"
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="button" className="find-close" title="Close (Esc)" aria-label="Close the find box" onClick={close}>
        <CloseIcon />
      </button>
      <span className="find-status" role="status" aria-live="polite">
        {status}
      </span>
    </div>
  )
}
