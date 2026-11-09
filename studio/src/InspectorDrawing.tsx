// Properties for one selected drawing: Delete, then the Drawing section with its kind, name and the props of its kind
// (drawing-props.ts). Each field writes its own setDrawingProps when it is left or Enter is pressed, so each commit is
// one history entry; a value the engine would refuse is refused here with the reason, and the field goes back.
import { useEffect, useId, useState } from "react"
import type { CircuitData, Design } from "./api"
import type { Actions } from "./App"
import { Row, Section } from "./InspectorRows"
import { CloseIcon, TrashIcon } from "./icons"
import { drawingBlocker, drawingInfo } from "./pcb/drawing-actions"
import { renamedId } from "./pcb/bus-tool"
import { drawingFieldEdit, drawingRows, type DrawingRow } from "./pcb/drawing-props"
import type { DrawingRename } from "./pcb/drawing-selection"
import type { CommandId } from "./shell/menus"

interface DrawingViewProps {
  design: Design
  circuit: CircuitData
  /** The selected drawing's id. */
  drawing: string
  locked: ReadonlySet<string>
  actions: Actions
  /** Tells the selection a bus is being renamed, so it follows the bus to its new id; the result forgets it. */
  onRename(rename: DrawingRename): () => void
  run(command: CommandId): void
  onClear(): void
  collapsed: ReadonlySet<string>
  toggle(title: string): void
}

const SECTION = "Drawing"

export function DrawingView({ design, circuit, drawing: id, locked, actions, onRename, run, onClear, collapsed, toggle }: DrawingViewProps) {
  const drawing = design.schematic.drawings.find((one) => one.id === id)
  if (!drawing) return null
  const blocker = drawingBlocker(circuit.model, locked, id)
  const rows = drawingRows(drawing, drawingInfo(circuit.model, id), blocker === null)
  const commit = (key: string, text: string): Promise<boolean> => {
    const result = drawingFieldEdit(drawing, key, text, circuit.model)
    if ("message" in result) {
      actions.notify(result.message)
      return Promise.resolve(false)
    }
    const { edit } = result
    const name = edit.kind === "setDrawingProps" ? edit.props["name"] : undefined
    const forget = typeof name === "string" ? onRename({ from: id, to: renamedId(circuit.model, id, name) }) : undefined
    return actions.edit([edit], result.summary).then((ok) => {
      if (!ok) forget?.()
      return ok
    })
  }
  return (
    <div className="inspector">
      <header className="insp-header">
        <span>Selected objects: 1</span>
        <button className="icon" aria-label="Clear the selection" onClick={onClear}>
          <CloseIcon />
        </button>
      </header>
      <div className="inspector-actions">
        <button className="danger" disabled={blocker !== null} title={blocker ?? "Delete this drawing (Delete)"} onClick={() => run("delete")}>
          <TrashIcon /> Delete
        </button>
      </div>
      {blocker && <p className="note">{blocker}.</p>}
      <Section title={SECTION} open={!collapsed.has(SECTION)} onToggle={() => toggle(SECTION)}>
        {rows.map((row) => (
          <DrawingField key={`${drawing.id}:${row.key}`} row={row} onCommit={(text) => commit(row.key, text)} />
        ))}
      </Section>
    </div>
  )
}

interface FieldProps {
  row: DrawingRow
  onCommit(text: string): Promise<boolean>
}

/** One row: text for what only shows (or is written as code), else the field its kind of value takes. */
function DrawingField({ row, onCommit }: FieldProps) {
  const id = useId()
  if (row.field === "static" || !row.editable) {
    return (
      <Row label={row.label}>
        <span className={row.field === "static" ? "static" : "expr"} title={row.value}>
          {row.value}
        </span>
      </Row>
    )
  }
  if (row.field === "check") {
    return (
      <Row label={row.label} htmlFor={id}>
        <input id={id} type="checkbox" checked={row.value === "true"} onChange={(e) => void onCommit(String(e.target.checked))} />
      </Row>
    )
  }
  if (row.field === "choice") {
    return (
      <Row label={row.label} htmlFor={id}>
        <select id={id} value={row.value} onChange={(e) => void onCommit(e.target.value)}>
          {row.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </Row>
    )
  }
  return <TypedField id={id} row={row} onCommit={onCommit} />
}

/** A typed value, written when the field is left or Enter is pressed; Esc puts the shown value back. */
function TypedField({ id, row, onCommit }: { id: string; row: DrawingRow; onCommit(text: string): Promise<boolean> }) {
  const [draft, setDraft] = useState(row.value)
  useEffect(() => setDraft(row.value), [row.value])
  const commit = () => {
    if (draft === row.value) return
    void onCommit(draft).then((ok) => ok || setDraft(row.value))
  }
  return (
    <Row label={row.label} htmlFor={id}>
      <input
        id={id}
        value={draft}
        placeholder={row.placeholder}
        title={row.hint}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
          if (e.key === "Escape") setDraft(row.value)
        }}
      />
    </Row>
  )
}
