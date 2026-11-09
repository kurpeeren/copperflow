// Properties for several selected objects (parts, schematic wires or both): their count, the actions that apply to all
// of them (Delete; Rotate, Lock and Unlock act on the parts), and the Selection section with the count of each kind and
// the parts by name. Each action runs the menu's command, so it does what Layout → Rotate or Edit → Delete does.
import type { PartInfo } from "./api"
import { GROUP_ACTIONS, groupActionEnabled, type PropertiesView } from "./inspector-sections"
import { Row, Section } from "./InspectorRows"
import { CloseIcon, LockIcon, RotateIcon, TrashIcon, UnlockIcon } from "./icons"
import type { CommandId } from "./shell/menus"

const ACTION_ICONS = { rotate: RotateIcon, lock: LockIcon, unlock: UnlockIcon, delete: TrashIcon } as const
const KIND_LABELS: Record<string, string> = { parts: "Parts", wires: "Wires" }

interface GroupProps {
  view: PropertiesView
  parts: readonly PartInfo[]
  /** How many schematic wires are selected with the parts. */
  wires: number
  /** The locked parts, and those of them changed outside the editor. */
  locks: { locked: ReadonlySet<string>; violated: ReadonlySet<string> }
  run(command: CommandId): void
  onClear(): void
  collapsed: ReadonlySet<string>
  toggle(title: string): void
}

export function GroupView({ view, parts, wires, locks, run, onClear, collapsed, toggle }: GroupProps) {
  const { locked } = locks
  const byName = new Map(parts.map((part) => [part.name, part]))
  const renderRow = (id: string) => {
    const [kind = "", rest = "", count = ""] = id.split(":")
    if (kind === "kind") {
      return (
        <Row key={id} label={KIND_LABELS[rest] ?? rest}>
          <span className="static">{count}</span>
        </Row>
      )
    }
    const name = id.slice("part:".length)
    const part = byName.get(name)
    return (
      <Row key={id} label={name}>
        <span className="static">
          {part?.tag}
          {locked.has(name) ? ", locked" : ""}
        </span>
      </Row>
    )
  }
  return (
    <div className="inspector">
      <header className="insp-header">
        <span>{view.header}</span>
        <button className="icon" aria-label="Clear the selection" onClick={onClear}>
          <CloseIcon />
        </button>
      </header>
      <div className="inspector-actions">
        {GROUP_ACTIONS.map(({ label, command }) => {
          const Icon = ACTION_ICONS[command]
          return (
            <button key={command} className={command === "delete" ? "danger" : undefined} disabled={!groupActionEnabled(command, parts, locks, wires)} onClick={() => run(command)}>
              <Icon /> {label}
            </button>
          )
        })}
      </div>
      {view.sections.map((section) => (
        <Section key={section.title} title={section.title} open={!collapsed.has(section.title)} onToggle={() => toggle(section.title)}>
          {section.rows.map(renderRow)}
        </Section>
      ))}
    </div>
  )
}
