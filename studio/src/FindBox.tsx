import { useEffect, useRef, type KeyboardEvent } from "react"
import "./find.css"

interface Props {
  text: string
  /** Changes on every request to focus the field (Ctrl+F, Edit → Find). */
  seq: number
  onText(text: string): void
  onSearch(text: string): void
  onClose(): void
}

/** The canvas area takes the focus back when the box closes. */
function focusCanvas(): void {
  document.getElementById("doc-panel")?.focus()
}

/** The small find box at the canvas's top right: Enter searches, Esc closes. */
export function FindBox({ text, seq, onText, onSearch, onClose }: Props) {
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
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") onSearch(text)
    else if (event.key === "Escape") {
      onClose()
      focusCanvas()
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") field.current?.select()
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
    </div>
  )
}
