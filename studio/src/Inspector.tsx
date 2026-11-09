import { useId, useState } from "react"
import type { BuildState, CircuitData, Design, Literal, PartInfo, PartsData } from "./api"
import type { Actions } from "./App"
import { BomSection } from "./BomSection"
import { checkSummary, type CheckCounts } from "./checks-list"
import { boardSections, inspectorSections, SUGGESTED_PROPS } from "./inspector-sections"
import { MarkForm, NewPropRow, PropRow, Row, Section } from "./InspectorRows"
import { LibraryInfo } from "./LibraryInfo"
import { CloseIcon, LockIcon, RotateIcon, TrashIcon, UnlockIcon } from "./icons"
import { touches } from "./LeftPanel"
import { pcbBoxes } from "./pcb/pcb-draw"
import { sideTabId, stripPanelId } from "./shell/SideStrip"
import "./inspector.css"

interface Props {
  circuit: CircuitData
  build: BuildState
  parts: PartsData
  selected: string | null
  onSelect(name: string | null): void
  actions: Actions
  /** The last build's errors and warnings, as the DRC tab counts them. */
  counts: CheckCounts
  onShowChecks(): void
  /** Hidden with the ] key; kept mounted so its fields keep what was typed. */
  hidden: boolean
}

/** Which sections are collapsed, and the way to flip one. */
interface SectionState {
  collapsed: ReadonlySet<string>
  toggle(title: string): void
}

/** The selected part's properties, or the board's state when nothing is selected. */
export function Inspector(props: Props) {
  const part = props.circuit.model.parts.find((p) => p.name === props.selected)
  // Collapsed sections are kept by title for as long as Studio is open.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const toggle = (title: string) =>
    setCollapsed((now) => {
      const next = new Set(now)
      if (!next.delete(title)) next.add(title)
      return next
    })
  return (
    <aside className="panel right" id={stripPanelId("right")} role="tabpanel" aria-labelledby={sideTabId("properties")} hidden={props.hidden}>
      {part ? <PartView {...props} collapsed={collapsed} toggle={toggle} part={part} /> : <BoardView {...props} collapsed={collapsed} toggle={toggle} />}
    </aside>
  )
}

/** The centre of the part on the board, where a note about it is placed. */
function centreOnBoard(design: Design | undefined, name: string): { x: number; y: number } | undefined {
  const box = design && pcbBoxes(design.pcb).find((b) => b.name === name)
  return box && { x: Math.round(box.center.x * 1000) / 1000, y: Math.round(box.center.y * 1000) / 1000 }
}

function PartView({ circuit, build, parts, part, actions, onSelect, collapsed, toggle }: Props & SectionState & { part: PartInfo }) {
  const locked = circuit.annotations.locks.some((lock) => lock.part === part.name)
  const library = parts.library.find((p) => p.component === part.tag)
  const setProp = (key: string, value: Literal) =>
    actions.edit([{ kind: "setProps", part: part.name, props: { [key]: value } }], `set ${part.name} ${key}=${JSON.stringify(value)}`)
  const canEdit = part.editable && !locked
  const traces = circuit.model.traces.filter((t) => touches(t, part.name))
  const renderRow = (id: string) => {
    const [kind, key = ""] = id.split(":")
    const prop = part.props[key]
    if (kind === "name") return <Row key={id} label="Name"><span className="static">{part.name}</span></Row>
    if (kind === "kind") return <Row key={id} label="Kind"><span className="static">{part.tag}, line {part.line}</span></Row>
    if (kind === "prop" && prop) return <PropRow key={id} name={key} prop={prop} disabled={!canEdit} onCommit={(value) => setProp(key, value)} notify={actions.notify} />
    if (kind === "suggest") {
      const example = SUGGESTED_PROPS[part.tag]?.find(([name]) => name === key)?.[1] ?? ""
      return <NewPropRow key={id} name={key} example={example} disabled={!canEdit} onCommit={(value) => setProp(key, value)} />
    }
    if (kind === "lock") return <LockRow key={id} locked={locked} onChange={(on) => void actions.lock([part.name], on)} />
    if (kind === "connections") return <Connections key={id} traces={traces} />
    if (kind === "library") return library && <LibraryInfo key={id} id={library.id} verified={library.verified} actions={actions} />
    return (
      <MarkForm
        key={id}
        label={`Note for the agent about ${part.name}`}
        onAdd={(text) => {
          const at = centreOnBoard(build.design, part.name)
          return actions.mark(at ? text : `${part.name}: ${text}`, at ? { view: "pcb", ...at } : undefined)
        }}
      />
    )
  }
  return (
    <div className="inspector">
      <header className="insp-header">
        <span>Selected objects: 1</span>
        <button className="icon" aria-label="Close" onClick={() => onSelect(null)}>
          <CloseIcon />
        </button>
      </header>
      <PartActions part={part} locked={locked} canEdit={canEdit} actions={actions} onSelect={onSelect} />
      {locked && <p className="note locked">Locked. The agent cannot move or change this part.</p>}
      {part.readonlyReason && <p className="note">Read-only here: {part.readonlyReason}. Change it in the code.</p>}
      {inspectorSections(part, { library: library !== undefined }).map((section) => (
        <Section key={section.title} title={section.title} open={!collapsed.has(section.title)} onToggle={() => toggle(section.title)}>
          {section.rows.map(renderRow)}
        </Section>
      ))}
    </div>
  )
}

/** Lock, rotate and remove, in a row under the header. */
function PartActions({ part, locked, canEdit, actions, onSelect }: {
  part: PartInfo
  locked: boolean
  canEdit: boolean
  actions: Actions
  onSelect(name: string | null): void
}) {
  const rotation = part.props.pcbRotation?.literal
  return (
    <div className="inspector-actions">
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
  )
}

function LockRow({ locked, onChange }: { locked: boolean; onChange(on: boolean): void }) {
  const id = useId()
  return (
    <Row label="Locked" htmlFor={id}>
      <input id={id} type="checkbox" checked={locked} onChange={(e) => onChange(e.target.checked)} />
    </Row>
  )
}

function Connections({ traces }: { traces: CircuitData["model"]["traces"] }) {
  if (traces.length === 0) return <p className="note">Not connected.</p>
  return (
    <ul className="part-traces">
      {traces.map((t, i) => (
        <li key={`${t.from}-${t.to}-${i}`}>
          <code>{t.from}</code> — <code>{t.to}</code>
        </li>
      ))}
    </ul>
  )
}

function BoardView({ circuit, build, actions, counts, onShowChecks, collapsed, toggle }: Props & SectionState) {
  const renderRow = (id: string) =>
    id === "build" ? (
      <div key={id}>
        {build.status === "failed" && <p className="note error">{build.error}</p>}
        {build.status === "building" && <p className="note">Building…</p>}
        {build.design && <CheckCountsNote counts={counts} onShowChecks={onShowChecks} />}
      </div>
    ) : (
      <div key={id}>
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
      </div>
    )
  return (
    <div className="inspector">
      <header className="insp-header">
        <span>Selected objects: 0</span>
        <span className="insp-file">
          {circuit.file}: {circuit.model.parts.length} parts, {circuit.model.traces.length} connections
        </span>
      </header>
      {boardSections().map((section) => (
        <Section key={section.title} title={section.title} open={!collapsed.has(section.title)} onToggle={() => toggle(section.title)}>
          {section.rows.map(renderRow)}
        </Section>
      ))}
      <BomSection file={circuit.file} buildId={build.finishedAt} actions={actions} />
      <p className="hint">Select a part to see and change its properties.</p>
    </div>
  )
}

/** The check counts the DRC tab shows, and a way to open it; the list itself lives in the tab. */
function CheckCountsNote({ counts, onShowChecks }: { counts: CheckCounts; onShowChecks(): void }) {
  const tone = counts.errors > 0 ? "error" : counts.warnings > 0 ? "warn" : "ok"
  return (
    <div className="check-counts">
      <p className={`note ${tone}`}>{checkSummary(counts)}</p>
      {counts.errors + counts.warnings > 0 && (
        <button onClick={onShowChecks} title="DRC (\)">
          Show checks
        </button>
      )}
    </div>
  )
}
