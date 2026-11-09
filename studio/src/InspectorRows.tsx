import { useEffect, useId, useState, type ReactNode } from "react"
import type { Literal, PropInfo } from "./api"
import { ChevronIcon } from "./icons"

/** One labelled row: the label on the left, the control on the right. */
export function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="insp-row">
      <label className="insp-label" htmlFor={htmlFor} title={label}>
        <span>{label}</span>
      </label>
      <div className="insp-value">{children}</div>
    </div>
  )
}

/** A collapsible group of rows; the body stays mounted so typed text survives a collapse. */
export function Section({ title, open, onToggle, children }: { title: string; open: boolean; onToggle(): void; children: ReactNode }) {
  return (
    <section className={open ? "insp-section" : "insp-section collapsed"}>
      <button type="button" className="insp-head hairline-t" aria-expanded={open} onClick={onToggle}>
        <ChevronIcon className="insp-chevron" />
        <span className="insp-title">{title}</span>
      </button>
      <div className="insp-body" hidden={!open}>
        {children}
      </div>
    </section>
  )
}

/** One property: an input for literal values, the code itself for expressions. */
export function PropRow({ name, prop, disabled, onCommit, notify }: {
  name: string
  prop: PropInfo
  disabled: boolean
  onCommit(value: Literal): Promise<boolean>
  notify(text: string): void
}) {
  const shown = prop.literal === undefined ? prop.source : String(prop.literal)
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])

  if (!prop.editable) {
    return (
      <Row label={name}>
        <code className="expr" title="An expression; change it in the code">{prop.source.replace(/\s+/g, " ")}</code>
      </Row>
    )
  }

  const commit = () => {
    if (draft === shown) return
    const value = parseLike(prop.literal, draft)
    if (value === undefined) {
      notify(`${name} needs ${typeof prop.literal === "number" ? "a number" : "true or false"}`)
      setDraft(shown)
      return
    }
    void onCommit(value).then((ok) => ok || setDraft(shown))
  }

  return (
    <Row label={name} htmlFor={`prop-${name}`}>
      <input
        id={`prop-${name}`}
        value={draft}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
          if (e.key === "Escape") setDraft(shown)
        }}
      />
    </Row>
  )
}

const NUMERIC_PROPS = new Set(["pcbX", "pcbY", "pcbRotation", "schX", "schY", "schRotation", "pinCount"])

/** An empty input for a usual prop the part does not have yet. */
export function NewPropRow({ name, example, disabled, onCommit }: {
  name: string
  example: string
  disabled: boolean
  onCommit(value: Literal): Promise<boolean>
}) {
  const [draft, setDraft] = useState("")
  const commit = () => {
    const text = draft.trim()
    if (!text) return
    const value = NUMERIC_PROPS.has(name) && Number.isFinite(Number(text)) ? Number(text) : text
    void onCommit(value).then((ok) => ok && setDraft(""))
  }
  return (
    <Row label={name} htmlFor={`new-prop-${name}`}>
      <input
        id={`new-prop-${name}`}
        className="new-prop"
        placeholder={example}
        value={draft}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
        }}
      />
    </Row>
  )
}

/** Converts typed text to the same kind of literal the prop already has. */
export function parseLike(current: Literal | undefined, text: string): Literal | undefined {
  if (typeof current === "number") {
    const value = Number(text)
    return text.trim() !== "" && Number.isFinite(value) ? value : undefined
  }
  if (typeof current === "boolean") return text === "true" ? true : text === "false" ? false : undefined
  return text
}

export function MarkForm({ label, onAdd }: { label: string; onAdd(text: string): Promise<boolean> }) {
  const [text, setText] = useState("")
  const id = useId()
  return (
    <form
      className="mark-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (text.trim()) void onAdd(text.trim()).then((ok) => ok && setText(""))
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="inline">
        <input id={id} value={text} onChange={(e) => setText(e.target.value)} placeholder="Route ground under this part" />
        <button type="submit">Add</button>
      </div>
    </form>
  )
}
