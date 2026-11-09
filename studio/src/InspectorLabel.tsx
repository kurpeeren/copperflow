// Properties for one selected net label or ground or power flag: Rename and Highlight net, then the Label section (net,
// text, and whether it sits at a pin or ends a hand-drawn wire). Rename opens the canvas's name field, as the context
// menu's Rename does; Highlight net runs the menu's command, which lights the selected label's net.
import type { Design } from "./api"
import { Row, Section } from "./InspectorRows"
import { CloseIcon } from "./icons"
import { labelProperties } from "./pcb/label-selection"
import type { CommandId } from "./shell/menus"
import { targetActions } from "./shell/target-actions"

interface LabelViewProps {
  design: Design
  /** The selected label's id. */
  label: string
  run(command: CommandId): void
  notify(text: string): void
  onClear(): void
  collapsed: ReadonlySet<string>
  toggle(title: string): void
}

const SECTION = "Label"

export function LabelView({ design, label, run, notify, onClear, collapsed, toggle }: LabelViewProps) {
  const shown = labelProperties(design, label)
  if (!shown) return null
  const rename = () => {
    if (!targetActions.send({ kind: "renameLabel", labelId: label })) notify("Open the schematic to rename this label.")
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
        <button title="Rename this label's net" onClick={rename}>
          Rename
        </button>
        <button title="Light this label's net in both views" onClick={() => run("highlight")}>
          Highlight net
        </button>
      </div>
      <Section title={SECTION} open={!collapsed.has(SECTION)} onToggle={() => toggle(SECTION)}>
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
