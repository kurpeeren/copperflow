import { useState } from "react"
import type { BuildState, CircuitData, CircuitElement, HistoryListing } from "./api"
import type { Actions } from "./App"
import { pcbCenterOf } from "./circuit-json"

interface Props {
  circuit: CircuitData
  json: CircuitElement[] | undefined
  build: BuildState
  history: HistoryListing[]
  selected: string | null
  onSelect(name: string | null): void
  actions: Actions
}

export function Sidebar(props: Props) {
  return (
    <aside>
      <Parts {...props} />
      <Traces {...props} />
      <Marks {...props} />
      <Build build={props.build} />
      <History history={props.history} actions={props.actions} />
    </aside>
  )
}

function Parts({ circuit, selected, onSelect, actions }: Props) {
  const locked = new Set(circuit.annotations.locks.map((lock) => lock.part))
  return (
    <section>
      <h2>Parts</h2>
      <ul className="list">
        {circuit.model.parts.map((part) => {
          const isLocked = locked.has(part.name)
          const rotation = part.props.pcbRotation?.literal
          const canRotate = part.editable && !isLocked && (rotation === undefined || typeof rotation === "number")
          return (
            <li
              key={part.name}
              className={`${selected === part.name ? "selected" : ""} ${part.editable ? "" : "readonly"}`}
              onClick={() => onSelect(part.name)}
              title={part.readonlyReason ? `Read-only: ${part.readonlyReason}` : undefined}
            >
              <span className="name">{part.name}</span>
              <span className="muted">{part.tag}</span>
              <span className="actions">
                <button
                  title={isLocked ? "Unlock" : "Lock so the agent cannot change it"}
                  className={isLocked ? "active" : ""}
                  onClick={(e) => {
                    e.stopPropagation()
                    void actions.lock([part.name], !isLocked)
                  }}
                >
                  {isLocked ? "Locked" : "Lock"}
                </button>
                <button
                  disabled={!canRotate}
                  title="Rotate 90°"
                  onClick={(e) => {
                    e.stopPropagation()
                    const next = (((typeof rotation === "number" ? rotation : 0) + 90) % 360 + 360) % 360
                    void actions.edit([{ kind: "setProps", part: part.name, props: { pcbRotation: next } }], `rotate ${part.name} to ${next}°`)
                  }}
                >
                  ⟳
                </button>
                <button
                  disabled={!part.editable || isLocked}
                  title="Remove the part and its traces"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (window.confirm(`Remove ${part.name} and its traces?`)) {
                      void actions.edit([{ kind: "removePart", part: part.name }], `remove ${part.name}`)
                    }
                  }}
                >
                  ✕
                </button>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Traces({ circuit, selected, actions }: Props) {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const traces = circuit.model.traces
  return (
    <section>
      <h2>Traces</h2>
      <ul className="list compact">
        {traces.map((trace, index) => {
          const involved = selected !== null && [trace.from, trace.to].some((end) => end?.includes(selected))
          return (
            <li key={`${trace.from}-${trace.to}-${index}`} className={involved ? "selected" : ""}>
              <span className="mono">{trace.editable ? `${trace.from} → ${trace.to}` : `line ${trace.line} (read-only)`}</span>
              <span className="actions">
                <button
                  disabled={!trace.editable}
                  title="Remove this trace"
                  onClick={() => {
                    if (trace.from && trace.to) {
                      void actions.edit([{ kind: "removeTrace", from: trace.from, to: trace.to }], `remove trace ${trace.from} -> ${trace.to}`)
                    }
                  }}
                >
                  ✕
                </button>
              </span>
            </li>
          )
        })}
      </ul>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          if (!from || !to) return
          void actions.edit([{ kind: "addTrace", from, to }], `add trace ${from} -> ${to}`).then((ok) => {
            if (ok) {
              setFrom("")
              setTo("")
            }
          })
        }}
      >
        <input placeholder=".R1 > .pin1" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Trace from" />
        <input placeholder="net.GND" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Trace to" />
        <button type="submit">Add</button>
      </form>
    </section>
  )
}

function Marks({ circuit, json, selected, actions }: Props) {
  const [text, setText] = useState("")
  const center = selected && json ? pcbCenterOf(json, selected) : undefined
  return (
    <section>
      <h2>Marks for the agent</h2>
      <ul className="list compact">
        {circuit.annotations.marks.map((mark) => (
          <li key={mark.id}>
            <span>
              <span className="muted">{mark.id}</span> {mark.text}
            </span>
            <span className="actions">
              <button title="Remove this mark" onClick={() => void actions.unmark(mark.id)}>
                ✕
              </button>
            </span>
          </li>
        ))}
      </ul>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text) return
          const at = center ? { view: "pcb" as const, x: center.x, y: center.y } : undefined
          const note = selected && !center ? `${selected}: ${text}` : text
          void actions.mark(note, at).then((ok) => ok && setText(""))
        }}
      >
        <input
          placeholder={selected ? `Note at ${selected}` : "Note, or select a part first"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Mark text"
        />
        <button type="submit">Add</button>
      </form>
      <p className="hint">Or draw a box on the PCB to place a mark there.</p>
    </section>
  )
}

function Build({ build }: { build: BuildState }) {
  if (build.status === "failed") {
    return (
      <section>
        <h2>Build</h2>
        <p className="error">{build.error}</p>
      </section>
    )
  }
  const report = build.report
  if (!report) return null
  return (
    <section>
      <h2>Build</h2>
      {report.errors.length === 0 && <p className="ok">No errors.</p>}
      <ul className="list compact">
        {report.errors.map((group) => (
          <li key={group.type} className="error">
            <span>
              {group.messages[0]}
              {group.count > 1 ? ` (+${group.count - 1})` : ""}
            </span>
          </li>
        ))}
      </ul>
      {report.warnings.length > 0 && <p className="hint">{report.warnings.reduce((s, g) => s + g.count, 0)} warnings</p>}
    </section>
  )
}

function History({ history, actions }: { history: HistoryListing[]; actions: Actions }) {
  return (
    <section>
      <h2>History</h2>
      <ul className="list compact">
        {history.map((entry) => (
          <li key={entry.id} className={entry.undone ? "undone" : ""}>
            <span>
              <span className={`badge ${entry.author}`}>{entry.author}</span> {entry.summary}
            </span>
            <span className="actions">
              {!entry.undone && !entry.undoOf && (
                <button title="Undo this change" onClick={() => void actions.undo(entry.id)}>
                  ↶
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
