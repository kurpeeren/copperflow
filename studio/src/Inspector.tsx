import { useEffect, useState } from "react"
import type { BuildState, CircuitData, CircuitElement, Literal, PartInfo, PropInfo } from "./api"
import type { Actions } from "./App"
import { pcbCenterOf } from "./circuit-json"
import { CloseIcon, LockIcon, RotateIcon, TrashIcon, UnlockIcon } from "./icons"
import { touches } from "./LeftPanel"

interface Props {
  circuit: CircuitData
  json: CircuitElement[] | undefined
  build: BuildState
  selected: string | null
  onSelect(name: string | null): void
  actions: Actions
}

/** The selected part's properties, or the board's state when nothing is selected. */
export function Inspector(props: Props) {
  const part = props.circuit.model.parts.find((p) => p.name === props.selected)
  return <aside className="panel right">{part ? <PartView {...props} part={part} /> : <BoardView {...props} />}</aside>
}

function PartView({ circuit, json, part, actions, onSelect }: Props & { part: PartInfo }) {
  const locked = circuit.annotations.locks.some((lock) => lock.part === part.name)
  const canEdit = part.editable && !locked
  const rotation = part.props.pcbRotation?.literal
  const traces = circuit.model.traces.filter((t) => touches(t, part.name))
  return (
    <div className="inspector">
      <header className="part-head">
        <div>
          <h2>{part.name}</h2>
          <p className="kind">
            {part.tag}, line {part.line}
          </p>
        </div>
        <button className="icon" aria-label="Close" onClick={() => onSelect(null)}>
          <CloseIcon />
        </button>
      </header>

      <div className="toolbar">
        <button className={locked ? "toggle on" : "toggle"} aria-pressed={locked} onClick={() => void actions.lock([part.name], !locked)}>
          {locked ? <LockIcon /> : <UnlockIcon />}
          {locked ? "Locked" : "Lock"}
        </button>
        <button
          disabled={!canEdit || (rotation !== undefined && typeof rotation !== "number")}
          onClick={() => {
            const next = ((((typeof rotation === "number" ? rotation : 0) + 90) % 360) + 360) % 360
            void actions.edit([{ kind: "setProps", part: part.name, props: { pcbRotation: next } }], `rotate ${part.name} to ${next}°`)
          }}
        >
          <RotateIcon /> Rotate
        </button>
        <button
          className="danger"
          disabled={!canEdit}
          onClick={() => {
            if (!window.confirm(`Remove ${part.name} and its connections?`)) return
            void actions.edit([{ kind: "removePart", part: part.name }], `remove ${part.name}`).then((ok) => ok && onSelect(null))
          }}
        >
          <TrashIcon /> Remove
        </button>
      </div>

      {locked && <p className="note locked">Locked. The agent cannot move or change this part.</p>}
      {part.readonlyReason && <p className="note">Read-only here: {part.readonlyReason}. Change it in the code.</p>}

      <h3>Properties</h3>
      <dl className="props">
        {Object.entries(part.props).map(([key, prop]) => (
          <PropRow key={key} name={key} prop={prop} disabled={!canEdit} onCommit={(value) => actions.edit([{ kind: "setProps", part: part.name, props: { [key]: value } }], `set ${part.name} ${key}=${JSON.stringify(value)}`)} notify={actions.notify} />
        ))}
      </dl>

      <h3>Connections</h3>
      {traces.length === 0 ? (
        <p className="note">Not connected.</p>
      ) : (
        <ul className="part-traces">
          {traces.map((t, i) => (
            <li key={`${t.from}-${t.to}-${i}`}>
              <code>{t.from}</code> — <code>{t.to}</code>
            </li>
          ))}
        </ul>
      )}

      <MarkForm label={`Note for the agent about ${part.name}`} onAdd={(text) => {
        const at = json ? pcbCenterOf(json, part.name) : undefined
        return actions.mark(at ? text : `${part.name}: ${text}`, at ? { view: "pcb", ...at } : undefined)
      }} />
    </div>
  )
}

/** One property: an input for literal values, the code itself for expressions. */
function PropRow({ name, prop, disabled, onCommit, notify }: {
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
      <>
        <dt>{name}</dt>
        <dd>
          <code className="expr" title="An expression; change it in the code">{prop.source.replace(/\s+/g, " ")}</code>
        </dd>
      </>
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
    <>
      <dt>
        <label htmlFor={`prop-${name}`}>{name}</label>
      </dt>
      <dd>
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
      </dd>
    </>
  )
}

/** Converts typed text to the same kind of literal the prop already has. */
function parseLike(current: Literal | undefined, text: string): Literal | undefined {
  if (typeof current === "number") {
    const value = Number(text)
    return text.trim() !== "" && Number.isFinite(value) ? value : undefined
  }
  if (typeof current === "boolean") return text === "true" ? true : text === "false" ? false : undefined
  return text
}

function BoardView({ circuit, build, actions }: Props) {
  const errors = build.report?.errors ?? []
  const warnings = build.report?.warnings.reduce((sum, g) => sum + g.count, 0) ?? 0
  return (
    <div className="inspector">
      <header className="part-head">
        <div>
          <h2>{circuit.file}</h2>
          <p className="kind">
            {circuit.model.parts.length} parts, {circuit.model.traces.length} connections
          </p>
        </div>
      </header>

      <h3>Build</h3>
      {build.status === "failed" && <p className="note error">{build.error}</p>}
      {build.status === "building" && <p className="note">Building with tscircuit…</p>}
      {build.report && errors.length === 0 && <p className="note ok">No errors. {warnings} warnings.</p>}
      {errors.length > 0 && (
        <ul className="issues">
          {errors.map((g) => (
            <li key={g.type}>
              {g.messages[0]}
              {g.count > 1 && <span className="more"> and {g.count - 1} more like it</span>}
            </li>
          ))}
        </ul>
      )}

      <h3>Notes for the agent</h3>
      {circuit.annotations.marks.length === 0 && <p className="note">Select a part to leave a note at it, or draw a box on the PCB.</p>}
      <ul className="marks">
        {circuit.annotations.marks.map((mark) => (
          <li key={mark.id}>
            <span>{mark.text}</span>
            <button className="icon" aria-label={`Remove note ${mark.id}`} onClick={() => void actions.unmark(mark.id)}>
              <CloseIcon />
            </button>
          </li>
        ))}
      </ul>
      <MarkForm label="Note for the agent" onAdd={(text) => actions.mark(text)} />
      <p className="hint">Select a part to see and change its properties.</p>
    </div>
  )
}

function MarkForm({ label, onAdd }: { label: string; onAdd(text: string): Promise<boolean> }) {
  const [text, setText] = useState("")
  return (
    <form
      className="mark-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (text.trim()) void onAdd(text.trim()).then((ok) => ok && setText(""))
      }}
    >
      <label htmlFor="mark-text">{label}</label>
      <div className="inline">
        <input id="mark-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Route ground under this part" />
        <button type="submit">Add</button>
      </div>
    </form>
  )
}
