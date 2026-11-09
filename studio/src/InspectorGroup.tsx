// Properties for several selected parts: their count, the actions that apply to all of them, and the Selection
// section that lists them. Each action runs the menu's command, so it does what Layout → Rotate or Edit → Delete does.
import type { PartInfo } from "./api"
import { GROUP_ACTIONS, groupActionEnabled, type PropertiesView } from "./inspector-sections"
import { Row, Section } from "./InspectorRows"
import { CloseIcon, LockIcon, RotateIcon, TrashIcon, UnlockIcon } from "./icons"
import type { CommandId } from "./shell/menus"

const ACTION_ICONS = { rotate: RotateIcon, lock: LockIcon, unlock: UnlockIcon, delete: TrashIcon } as const

interface GroupProps {
  view: PropertiesView
  parts: readonly PartInfo[]
  /** The locked parts, and those of them changed outside the editor. */
  locks: { locked: ReadonlySet<string>; violated: ReadonlySet<string> }
  run(command: CommandId): void
  onClear(): void
  collapsed: ReadonlySet<string>
  toggle(title: string): void
}

export function GroupView({ view, parts, locks, run, onClear, collapsed, toggle }: GroupProps) {
  const { locked } = locks
  const byName = new Map(parts.map((part) => [part.name, part]))
  const renderRow = (id: string) => {
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
            <button key={command} className={command === "delete" ? "danger" : undefined} disabled={!groupActionEnabled(command, parts, locks)} onClick={() => run(command)}>
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
