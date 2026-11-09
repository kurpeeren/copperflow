// Properties for one selected track or via: Delete, then the Track or Via section (copper-props.ts): net, layer, width,
// length and who drew it, with the width, the layer and the lock editable; a via's net, layers, drill and diameter.
// Each change is one layout edit, so one history entry; Delete runs the command Edit → Delete runs.
import { useEffect, useId, useState } from "react"
import type { Design } from "./api"
import type { Actions } from "./App"
import { Row, Section } from "./InspectorRows"
import { CloseIcon, TrashIcon } from "./icons"
import { copperFieldEdit, copperProperties, type CopperField, type CopperRow } from "./pcb/copper-props"
import type { CommandId } from "./shell/menus"

interface CopperViewProps {
  design: Design
  /** The selected track's or via's id. */
  id: string
  actions: Actions
  run(command: CommandId): void
  onClear(): void
  collapsed: ReadonlySet<string>
  toggle(title: string): void
}

const LAYER_CHOICES = [
  { value: "top", label: "Top Layer" },
  { value: "bottom", label: "Bottom Layer" },
] as const

export function CopperView({ design, id, actions, run, onClear, collapsed, toggle }: CopperViewProps) {
  const shown = copperProperties(design, id)
  const item = design.pcb.tracks.find((one) => one.id === id) ?? design.pcb.vias.find((one) => one.id === id)
  if (!shown || !item) return null
  const commit = async (field: CopperField, raw: string): Promise<boolean> => {
    const change = copperFieldEdit(item, field, raw)
    if (!change) return true
    if ("message" in change) {
      actions.notify(change.message)
      return false
    }
    return (await actions.editLayout([change.edit], change.summary)).ok
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
        <button className="danger" disabled={shown.locked} title={shown.locked ? `${id} is locked` : `Delete this ${shown.kind} (Delete)`} onClick={() => run("delete")}>
          <TrashIcon /> Delete
        </button>
      </div>
      <Section title={shown.title} open={!collapsed.has(shown.title)} onToggle={() => toggle(shown.title)}>
        {shown.rows.map((row) => (
          <CopperRowView key={row.label} row={row} locked={shown.locked} onCommit={commit} />
        ))}
      </Section>
    </div>
  )
}

function CopperRowView({ row, locked, onCommit }: { row: CopperRow; locked: boolean; onCommit(field: CopperField, raw: string): Promise<boolean> }) {
  const id = useId()
  if (row.field === "lock") {
    return (
      <Row label={row.label} htmlFor={id}>
        <input id={id} type="checkbox" checked={row.value === "true"} onChange={(e) => void onCommit("lock", String(e.target.checked))} />
      </Row>
    )
  }
  if (row.field === "layer") {
    return (
      <Row label={row.label} htmlFor={id}>
        <select id={id} value={row.value} disabled={locked} onChange={(e) => void onCommit("layer", e.target.value)}>
          {LAYER_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
          {/* An inner layer has no Layer panel row yet: it is shown, and can be left, but not chosen. */}
          {!LAYER_CHOICES.some((choice) => choice.value === row.value) && (
            <option value={row.value} disabled>
              {row.value === "inner1" ? "Inner Layer 1" : "Inner Layer 2"}
            </option>
          )}
        </select>
      </Row>
    )
  }
  if (row.field === "width") return <WidthField id={id} value={row.value} locked={locked} onCommit={(raw) => onCommit("width", raw)} />
  return (
    <Row label={row.label}>
      <span className="static" title={row.value}>
        {row.value}
      </span>
    </Row>
  )
}

/** The width in mm, written when the field is left or Enter is pressed; Esc puts the shown value back. */
function WidthField({ id, value, locked, onCommit }: { id: string; value: string; locked: boolean; onCommit(raw: string): Promise<boolean> }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft !== value) void onCommit(draft).then((ok) => ok || setDraft(value))
  }
  return (
    <Row label="Width (mm)" htmlFor={id}>
      <input
        id={id}
        value={draft}
        disabled={locked}
        inputMode="decimal"
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
          if (e.key === "Escape") setDraft(value)
        }}
      />
    </Row>
  )
}
