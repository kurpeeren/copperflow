// Properties for one selected copper pour, hole or silkscreen text: Delete, then the Copper pour section (net, layer,
// priority, clearance, minimum width and thermal relief editable; the outline and the fill area shown), the Hole
// section (position and diameter) or the Silkscreen text section (words, position, height, turn and side), with a Lock button as a part has. Each change is one edit of the circuit file, so one history
// entry (pour-props.ts); a locked or read-only pour or hole shows its rows without fields.
import { useEffect, useId, useState } from "react"
import type { CircuitData, Design } from "./api"
import type { Actions } from "./App"
import { Row, Section } from "./InspectorRows"
import { CloseIcon, LockIcon, TrashIcon, UnlockIcon } from "./icons"
import { boardFieldEdit, boardLockButton, boardProperties, type BoardField, type BoardRow } from "./pcb/pour-props"
import { boardItemBlocker } from "./pcb/pour-tool"
import type { CommandId } from "./shell/menus"

const DELETE_WORD = { pour: "copper pour", hole: "hole", text: "silkscreen text", graphic: "drawing" } as const

interface PourViewProps {
  design: Design
  circuit: CircuitData
  /** The selected pour's or hole's id. */
  id: string
  /** The locked parts, pours and holes, and those of them changed outside the editor. */
  locks: { locked: ReadonlySet<string>; violated: ReadonlySet<string> }
  actions: Actions
  run(command: CommandId): void
  onClear(): void
  collapsed: ReadonlySet<string>
  toggle(title: string): void
}

export function PourView({ design, circuit, id, locks, actions, run, onClear, collapsed, toggle }: PourViewProps) {
  const shown = boardProperties(design, id)
  if (!shown) return null
  const blocker = boardItemBlocker(circuit.model, locks.locked, id)
  const lock = boardLockButton(id, locks)
  const commit = async (field: BoardField, raw: string): Promise<boolean> => {
    const change = boardFieldEdit(design, id, field, raw)
    if (!change) return true
    if ("message" in change) {
      actions.notify(change.message)
      return false
    }
    return actions.edit([change.edit], change.summary)
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
        <button className={lock.pressed ? "toggle on" : "toggle"} aria-pressed={lock.pressed} title={lock.title} onClick={() => run(lock.command)}>
          {lock.pressed ? <LockIcon /> : <UnlockIcon />}
          {lock.label}
        </button>
        <button className="danger" disabled={blocker !== null} title={blocker ?? `Delete this ${DELETE_WORD[shown.kind]} (Delete)`} onClick={() => run("delete")}>
          <TrashIcon /> Delete
        </button>
      </div>
      <Section title={shown.title} open={!collapsed.has(shown.title)} onToggle={() => toggle(shown.title)}>
        {shown.rows.map((row) => (
          <BoardRowView key={row.label} row={row} disabled={blocker !== null} onCommit={commit} />
        ))}
      </Section>
    </div>
  )
}

function BoardRowView({ row, disabled, onCommit }: { row: BoardRow; disabled: boolean; onCommit(field: BoardField, raw: string): Promise<boolean> }) {
  const id = useId()
  const { field, choices } = row
  if (!field || disabled) {
    return (
      <Row label={row.label}>
        <span className="static" title={row.value}>
          {row.value === "" ? "Net class" : row.value}
        </span>
      </Row>
    )
  }
  if (choices) {
    return (
      <Row label={row.label} htmlFor={id}>
        <select id={id} value={row.value} onChange={(e) => void onCommit(field, e.target.value)}>
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
          {!choices.some((choice) => choice.value === row.value) && (
            <option value={row.value} disabled>
              {row.value}
            </option>
          )}
        </select>
      </Row>
    )
  }
  return <NumberField id={id} row={row} field={field} onCommit={onCommit} />
}

/** A number written when the field is left or Enter is pressed; Esc puts the shown value back. An empty clearance means the net class's. */
function NumberField({ id, row, field, onCommit }: { id: string; row: BoardRow; field: BoardField; onCommit(field: BoardField, raw: string): Promise<boolean> }) {
  const [draft, setDraft] = useState(row.value)
  useEffect(() => setDraft(row.value), [row.value])
  const commit = () => {
    if (draft !== row.value) void onCommit(field, draft).then((ok) => ok || setDraft(row.value))
  }
  return (
    <Row label={row.label} htmlFor={id}>
      <input
        id={id}
        value={draft}
        inputMode={field === "text" ? "text" : "decimal"}
        spellCheck={false}
        placeholder={field === "clearance" ? "Net class" : undefined}
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
