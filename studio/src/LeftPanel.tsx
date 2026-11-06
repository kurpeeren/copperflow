import { useState } from "react"
import type { CircuitData, Design, HistoryListing, PartsData, TraceInfo } from "./api"
import { Library } from "./Library"
import { NetsList } from "./NetsList"
import { blurButton } from "./pcb/CanvasTools"
import type { Actions } from "./App"
import type { LeftTab } from "./use-workspace"
import { partsInSelector } from "../../src/core/selectors.js"
import { CloseIcon, LockIcon, UndoIcon } from "./icons"

interface Props {
  circuit: CircuitData
  history: HistoryListing[]
  parts: PartsData
  onPlace(part: string): void
  selected: string | null
  onSelect(name: string | null): void
  actions: Actions
  /** The built design, for the Nets tab. */
  design: Design | undefined
  tab: LeftTab
  onTab(tab: LeftTab): void
  /** Shift+F asked for the Library search field. */
  focusSearch: boolean
  onSearchFocused(): void
  highlight: string | null
  onHighlight(net: string | null): void
  hidden: boolean
}

const TAB_NAMES: Record<LeftTab, string> = { parts: "Parts", library: "Library", nets: "Nets", connections: "Wires", history: "History" }

/** The object tree: parts grouped by kind, every net and connection, and the change history. */
export function LeftPanel(props: Props) {
  const { tab, onTab } = props
  return (
    <aside className="panel left" hidden={props.hidden} onClick={blurButton}>
      <div className="tabs" role="tablist">
        {(Object.keys(TAB_NAMES) as LeftTab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => onTab(t)}>
            {TAB_NAMES[t]}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === "parts" && <PartsTree {...props} />}
        {tab === "library" && <Library parts={props.parts} onPlace={props.onPlace} focus={props.focusSearch} onFocused={props.onSearchFocused} />}
        {tab === "nets" && <NetsList design={props.design} highlight={props.highlight} onHighlight={props.onHighlight} />}
        {tab === "connections" && <Connections {...props} />}
        {tab === "history" && <History history={props.history} actions={props.actions} />}
      </div>
    </aside>
  )
}

function PartsTree({ circuit, parts: library, selected, onSelect }: Props) {
  const locked = new Set(circuit.annotations.locks.map((lock) => lock.part))
  const title = (tag: string) => library.library.find((p) => p.component === tag)?.title ?? tag
  const groups = new Map<string, typeof circuit.model.parts>()
  for (const part of circuit.model.parts) groups.set(part.tag, [...(groups.get(part.tag) ?? []), part])
  return (
    <div className="tree">
      {[...groups].map(([tag, parts]) => (
        <section key={tag}>
          <h3 title={tag}>
            {title(tag)} <span className="count">{parts.length}</span>
          </h3>
          <ul>
            {parts.map((part) => (
              <li key={part.name}>
                <button
                  className={`row${selected === part.name ? " selected" : ""}${part.editable ? "" : " readonly"}`}
                  onClick={() => onSelect(selected === part.name ? null : part.name)}
                  title={part.readonlyReason ? `Read-only: ${part.readonlyReason}` : undefined}
                >
                  <span className="name">{part.name}</span>
                  <span className="value">{summaryValue(part.props)}</span>
                  {locked.has(part.name) && <LockIcon className="locked-icon" aria-label="Locked" />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {circuit.model.skipped.length > 0 && (
        <p className="note">
          {circuit.model.skipped.length} element(s) cannot be edited here; see the code.
        </p>
      )}
    </div>
  )
}

/** The value people recognise a part by: resistance, capacitance, colour or footprint. */
function summaryValue(props: CircuitData["model"]["parts"][number]["props"]): string {
  for (const key of ["resistance", "capacitance", "inductance", "color", "footprint", "standard"]) {
    const literal = props[key]?.literal
    if (literal !== undefined) return String(literal)
  }
  return ""
}

function Connections({ circuit, selected, actions }: Props) {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  return (
    <div className="connections">
      <ul>
        {circuit.model.traces.map((trace, index) => (
          <li key={`${trace.from}-${trace.to}-${index}`} className={touches(trace, selected) ? "selected" : ""}>
            <code>{trace.editable ? trace.from : `line ${trace.line}`}</code>
            <span className="arrow" aria-hidden="true">
              —
            </span>
            <code>{trace.editable ? trace.to : "read-only"}</code>
            <button
              className="icon"
              disabled={!trace.editable}
              aria-label={`Remove connection ${trace.from} to ${trace.to}`}
              onClick={() => {
                if (trace.from && trace.to) {
                  void actions.edit([{ kind: "removeTrace", from: trace.from, to: trace.to }], `remove trace ${trace.from} -> ${trace.to}`)
                }
              }}
            >
              <CloseIcon />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="add-connection"
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
        <label>
          From
          <input placeholder=".R1 > .pin1" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input placeholder="net.GND" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="submit" className="primary">
          Connect
        </button>
      </form>
    </div>
  )
}

export function touches(trace: TraceInfo, part: string | null): boolean {
  if (!part) return false
  return [trace.from, trace.to].some((end) => end !== undefined && partsInSelector(end).includes(part))
}

function History({ history, actions }: { history: HistoryListing[]; actions: Actions }) {
  if (history.length === 0) return <p className="note">Changes from you and the agent appear here.</p>
  return (
    <ul className="history">
      {history.map((entry) => (
        <li key={entry.id} className={entry.undone ? "undone" : ""}>
          <span className={`who ${entry.author}`}>{entry.author === "ai" ? "Agent" : "You"}</span>
          <span className="what">{entry.summary}</span>
          {!entry.undone && !entry.undoOf && (
            <button className="icon" aria-label={`Undo ${entry.summary}`} onClick={() => void actions.undo(entry.id)}>
              <UndoIcon />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
