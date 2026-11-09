// Properties for a selected schematic wire: Highlight net, Remove corners and Delete, then the Wire section (net, ends,
// corners, and whether a trace or Studio draws it). Each button runs the command the context menu and Edit → Delete
// run, so it does the same and is refused the same; a button that cannot run is off, with its reason.
import type { CircuitData, Design } from "./api"
import { Row, Section } from "./InspectorRows"
import { CloseIcon, TrashIcon } from "./icons"
import { wireProperties } from "./pcb/wire-actions"
import type { CommandId } from "./shell/menus"

interface WireViewProps {
  design: Design
  circuit: CircuitData
  /** The selected wire's id. */
  wire: string
  locked: ReadonlySet<string>
  run(command: CommandId): void
  onClear(): void
  collapsed: ReadonlySet<string>
  toggle(title: string): void
}

const SECTION = "Wire"

export function WireView({ design, circuit, wire, locked, run, onClear, collapsed, toggle }: WireViewProps) {
  const shown = wireProperties(design, circuit, wire, locked)
  if (!shown) return null
  return (
    <div className="inspector">
      <header className="insp-header">
        <span>Selected objects: 1</span>
        <button className="icon" aria-label="Clear the selection" onClick={onClear}>
          <CloseIcon />
        </button>
      </header>
      <div className="inspector-actions">
        <button disabled={shown.net === undefined} title="Light this wire's net in both views" onClick={() => run("highlight")}>
          Highlight net
        </button>
        <button disabled={shown.removeCorners !== null} title={shown.removeCorners ?? "Let Studio draw this wire on its own, with at most one elbow"} onClick={() => run("removeCorners")}>
          Remove corners
        </button>
        <button className="danger" disabled={shown.remove !== null} title={shown.remove ?? "Delete this wire's trace (Delete)"} onClick={() => run("delete")}>
          <TrashIcon /> Delete
        </button>
      </div>
      {shown.remove && <p className="note">{shown.remove}.</p>}
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
