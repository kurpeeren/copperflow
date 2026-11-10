import { useEffect, useId, useRef, useState, type RefObject } from "react"
import type { BuildState, CircuitData, Design, Literal, PartInfo, PartsData } from "./api"
import type { Actions } from "./App"
import { BomSection } from "./BomSection"
import { checkSummary, type CheckCounts } from "./checks-list"
import { FIRST_FIELD, groupActionEnabled, partLockButton, PLACED_ROW, propertiesKind, propertiesView, SUGGESTED_PROPS, type PropertiesView } from "./inspector-sections"
import { GroupView } from "./InspectorGroup"
import { LabelView } from "./InspectorLabel"
import { DrawingView } from "./InspectorDrawing"
import { CopperView } from "./InspectorCopper"
import { WireView } from "./InspectorWire"
import { TextView } from "./InspectorText"
import { MarkForm, NewPropRow, PropRow, Row, Section } from "./InspectorRows"
import { LibraryInfo } from "./LibraryInfo"
import { CloseIcon, LockIcon, RotateIcon, TrashIcon, UnlockIcon } from "./icons"
import { touches } from "./LeftPanel"
import { autoPlacedParts } from "./pcb/auto-placed"
import { pcbBoxes } from "./pcb/pcb-draw"
import { TEXT_NAMES } from "./pcb/part-text"
import type { View } from "./pcb/positions"
import type { DrawingRename } from "./pcb/drawing-selection"
import type { Selection, SelectionChange } from "./selection"
import type { CommandId } from "./shell/menus"
import { sideTabId, stripPanelId } from "./shell/SideStrip"
import "./inspector.css"

interface Props {
  circuit: CircuitData
  build: BuildState
  parts: PartsData
  /** The open view: a part Studio placed there says so. */
  openView: View
  selection: Selection
  onSelect(change: SelectionChange): void
  onRenameDrawing(rename: DrawingRename): () => void
  actions: Actions
  /** Runs a menu command; the actions for several parts go through it, so they do what the menu does. */
  run(command: CommandId): void
  /** The last build's errors and warnings, as the DRC tab counts them. */
  counts: CheckCounts
  onShowChecks(): void
  /** Hidden with the ] key; kept mounted so its fields keep what was typed. */
  hidden: boolean
  /** Asked for by a double click on a part: move the focus to its first field, then call onFieldFocused. */
  focusField: boolean
  onFieldFocused(): void
}

/** Which sections are collapsed, the way to flip one, and what Properties shows. */
interface SectionState {
  collapsed: ReadonlySet<string>
  toggle(title: string): void
  view: PropertiesView
}

/** The locked parts, and those of them changed outside the editor. */
type Locks = { locked: ReadonlySet<string>; violated: ReadonlySet<string> }

/** The selected parts in the order they were picked, as the circuit has them now. */
function selectedParts(circuit: CircuitData, selection: Selection): PartInfo[] {
  return selection.names.flatMap((name) => circuit.model.parts.find((part) => part.name === name) ?? [])
}

/** Moves the focus to the first property field once one is asked for and the panel shows. */
function useFieldFocus(panel: RefObject<HTMLElement | null>, requested: boolean, done: () => void): void {
  useEffect(() => {
    if (!requested) return
    panel.current?.querySelector<HTMLInputElement>(FIRST_FIELD)?.focus()
    done()
  }, [panel, requested, done])
}

/**
 * The board's state with nothing selected, a part's properties with one, a wire's, a label's or a drawing's own with
 * one alone, and the counts by kind with the shared actions for several (parts, wires, labels and drawings).
 */
export function Inspector(props: Props) {
  const panel = useRef<HTMLElement>(null)
  useFieldFocus(panel, props.focusField, props.onFieldFocused)
  const parts = selectedParts(props.circuit, props.selection)
  const [part] = parts
  const { wireCount, labelCount, drawingCount, copperCount, soleWire: wire, soleLabel: label, soleDrawing: drawing, soleCopper, soleText, textCount } = props.selection
  const kind = propertiesKind(parts.length, wireCount, labelCount, drawingCount, copperCount, textCount)
  const library = kind === "part" && part ? props.parts.library.find((p) => p.component === part.tag) : undefined
  const autoPlaced = kind === "part" && part !== undefined && autoPlacedParts(props.build.design, props.openView).has(part.name)
  const view = propertiesView(parts, { library: library !== undefined, autoPlaced }, wireCount, labelCount, drawingCount, copperCount, textCount)
  const locks = { locked: new Set(props.circuit.annotations.locks.map((lock) => lock.part)), violated: new Set(props.circuit.violations.map((v) => v.part)) }
  // Collapsed sections are kept by title for as long as Studio is open.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const toggle = (title: string) =>
    setCollapsed((now) => {
      const next = new Set(now)
      if (!next.delete(title)) next.add(title)
      return next
    })
  const clear = () => props.onSelect((current) => current.clear())
  const design = props.build.design
  return (
    <aside ref={panel} className="panel right" id={props.hidden ? undefined : stripPanelId("right")} role="tabpanel" aria-labelledby={sideTabId("properties")} hidden={props.hidden}>
      {kind === "wire" && wire !== undefined && design && <WireView design={design} circuit={props.circuit} wire={wire} locked={locks.locked} run={props.run} onClear={clear} collapsed={collapsed} toggle={toggle} />}
      {kind === "label" && label !== undefined && design && <LabelView design={design} label={label} run={props.run} notify={props.actions.notify} onClear={clear} collapsed={collapsed} toggle={toggle} />}
      {kind === "drawing" && drawing !== undefined && design && <DrawingView design={design} circuit={props.circuit} drawing={drawing} locked={locks.locked} actions={props.actions} onRename={props.onRenameDrawing} run={props.run} onClear={clear} collapsed={collapsed} toggle={toggle} />}
      {kind === "text" && soleText !== undefined && design && <TextView design={design} circuit={props.circuit} text={soleText} locked={locks.locked} actions={props.actions} onClear={clear} collapsed={collapsed} toggle={toggle} />}
      {kind === "copper" && soleCopper !== undefined && design && <CopperView design={design} id={soleCopper} actions={props.actions} run={props.run} onClear={clear} collapsed={collapsed} toggle={toggle} />}
      {kind === "group" && <GroupView view={view} parts={parts} others={wireCount + labelCount + drawingCount + copperCount} locks={locks} run={props.run} onClear={clear} collapsed={collapsed} toggle={toggle} />}
      {kind === "part" && part && <PartView {...props} view={view} collapsed={collapsed} toggle={toggle} part={part} locks={locks} />}
      {kind === "board" && <BoardView {...props} view={view} collapsed={collapsed} toggle={toggle} />}
    </aside>
  )
}

/** The centre of the part on the board, where a note about it is placed. */
function centreOnBoard(design: Design | undefined, name: string): { x: number; y: number } | undefined {
  const box = design && pcbBoxes(design.pcb).find((b) => b.name === name)
  return box && { x: Math.round(box.center.x * 1000) / 1000, y: Math.round(box.center.y * 1000) / 1000 }
}

function PartView({ circuit, build, parts, part, locks, actions, onSelect, run, view, collapsed, toggle }: Props & SectionState & { part: PartInfo; locks: Locks }) {
  const locked = locks.locked.has(part.name)
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
    if (kind === "placed") return <Row key={id} label={PLACED_ROW.label}><span className="static">{PLACED_ROW.value}</span></Row>
    if (kind === "prop" && prop) return <PropRow key={id} name={key} prop={prop} disabled={!canEdit} onCommit={(value) => setProp(key, value)} notify={actions.notify} />
    if (kind === "suggest") {
      const example = SUGGESTED_PROPS[part.tag]?.find(([name]) => name === key)?.[1] ?? ""
      return <NewPropRow key={id} name={key} example={example} disabled={!canEdit} onCommit={(value) => setProp(key, value)} />
    }
    if (kind === "textAt" && prop) return <Row key={id} label={`${TEXT_NAMES[key] ?? key} offset`}><span className="static" title="Drag it on the canvas, or select it for Reset position">{prop.source.replace(/[{}]/g, "").trim()}</span></Row>
    if (kind === "lock") return <LockRow key={id} locked={locked} onChange={(on) => run(on ? "lock" : "unlock")} />
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
        <span>{view.header}</span>
        <button className="icon" aria-label="Close" onClick={() => onSelect((current) => current.clear())}>
          <CloseIcon />
        </button>
      </header>
      <PartActions part={part} locks={locks} run={run} />
      {locked && <p className="note locked">Locked. The agent cannot move or change this part.</p>}
      {part.readonlyReason && <p className="note">Read-only here: {part.readonlyReason}. Change it in the code.</p>}
      {view.sections.map((section) => (
        <Section key={section.title} title={section.title} open={!collapsed.has(section.title)} onToggle={() => toggle(section.title)}>
          {section.rows.map(renderRow)}
        </Section>
      ))}
    </div>
  )
}

/**
 * Lock, rotate and remove, in a row under the header. Each runs the menu's command on the selection (this part), so
 * it is enabled, asks and is refused as Edit → Delete, Layout → Rotate and Lock are, and as the group's buttons are.
 */
function PartActions({ part, locks, run }: { part: PartInfo; locks: Locks; run(command: CommandId): void }) {
  const lock = partLockButton(part.name, locks)
  const enabled = (command: "rotate" | "delete") => groupActionEnabled(command, [part], locks)
  return (
    <div className="inspector-actions">
      <button className={lock.pressed ? "toggle on" : "toggle"} aria-pressed={lock.pressed} title={lock.title} onClick={() => run(lock.command)}>
        {lock.pressed ? <LockIcon /> : <UnlockIcon />}
        {lock.label}
      </button>
      <button disabled={!enabled("rotate")} onClick={() => run("rotate")}>
        <RotateIcon /> Rotate
      </button>
      <button className="danger" disabled={!enabled("delete")} onClick={() => run("delete")}>
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

function BoardView({ circuit, build, actions, counts, onShowChecks, view, collapsed, toggle }: Props & SectionState) {
  const renderRow = (id: string) =>
    id === "build" ? (
      <div key={id}>
        {build.status === "failed" && <p className="note error">{build.error}</p>}
        {build.status === "building" && <p className="note">Building…</p>}
        {build.design && <CheckCountsNote counts={counts} onShowChecks={onShowChecks} />}
      </div>
    ) : (
      <div key={id}>
        {circuit.annotations.marks.length === 0 && <p className="note">Select a part to leave a note at it, or use Place → Note box to draw one on the canvas.</p>}
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
        <span>{view.header}</span>
        <span className="insp-file">
          {circuit.file}: {circuit.model.parts.length} parts, {circuit.model.traces.length} connections
        </span>
      </header>
      {view.sections.map((section) => (
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
