// Properties for one selected part name or value (schematic) or silkscreen designator (PCB): Reset position, which
// removes the prop that moved it so the layout puts it back, then the section with the part, the text and its offset
// from the part's origin. Delete does nothing to it; hiding one is another matter.
import type { CircuitData, Design } from "./api"
import type { Actions } from "./App"
import { Row, Section } from "./InspectorRows"
import { CloseIcon } from "./icons"
import { textProperties, textResetEdits, textResetReason } from "./pcb/part-text"

interface TextViewProps {
  design: Design
  circuit: CircuitData
  /** The selected text's id, "R1:schNameAt". */
  text: string
  locked: ReadonlySet<string>
  actions: Actions
  onClear(): void
  collapsed: ReadonlySet<string>
  toggle(title: string): void
}

export function TextView({ design, circuit, text, locked, actions, onClear, collapsed, toggle }: TextViewProps) {
  const shown = textProperties(design, circuit, text, locked)
  if (!shown) return null
  const resetBlocked = textResetReason(design, circuit, text, locked)
  const reset = () => void actions.edit(textResetEdits(text), `Reset ${shown.rows[0]?.value ?? ""} ${shown.title.toLowerCase()} position`)
  return (
    <div className="inspector">
      <header className="insp-header">
        <span>Selected objects: 1</span>
        <button className="icon" aria-label="Clear the selection" onClick={onClear}>
          <CloseIcon />
        </button>
      </header>
      <div className="inspector-actions">
        <button disabled={resetBlocked !== null} title={resetBlocked ?? "Put it back where the layout puts it"} onClick={reset}>
          Reset position
        </button>
      </div>
      {shown.blocker && <p className="note">{shown.blocker}.</p>}
      <Section title={shown.title} open={!collapsed.has(shown.title)} onToggle={() => toggle(shown.title)}>
        {shown.rows.map((row) => (
          <Row key={row.label} label={row.label}>
            <span className="static" title={row.value}>
              {row.value}
            </span>
          </Row>
        ))}
      </Section>
    </div>
  )
}
