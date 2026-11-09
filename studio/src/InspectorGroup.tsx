// Properties for several selected parts: their count, the actions that apply to all of them, and the Selection
// section that lists them. Each action runs the menu's command, so it does what Layout → Rotate or Edit → Delete does.
import type { PartInfo } from "./api"
import { GROUP_ACTIONS, type PropertiesView } from "./inspector-sections"
import { Row, Section } from "./InspectorRows"
import { CloseIcon, LockIcon, RotateIcon, TrashIcon, UnlockIcon } from "./icons"
import { lockChange } from "./pcb/group-edits"
import type { CommandId } from "./shell/menus"

const ACTION_ICONS = { rotate: RotateIcon, lock: LockIcon, unlock: UnlockIcon, delete: TrashIcon } as const

interface GroupProps {
  view: PropertiesView
  parts: readonly PartInfo[]
  locked: ReadonlySet<string>
  run(command: CommandId): void
  onClear(): void
  collapsed: ReadonlySet<string>
  toggle(title: string): void
}

/** Whether a group action can change any of the parts: Lock some unlocked one, Unlock some locked one, the rest some editable one. */
function canRun(command: (typeof GROUP_ACTIONS)[number]["command"], parts: readonly PartInfo[], locked: ReadonlySet<string>): boolean {
  const names = parts.map((part) => part.name)
  if (command === "lock" || command === "unlock") return "parts" in lockChange(names, locked, command === "lock")
  return parts.some((part) => part.editable && !locked.has(part.name))
}

export function GroupView({ view, parts, locked, run, onClear, collapsed, toggle }: GroupProps) {
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
            <button key={command} className={command === "delete" ? "danger" : undefined} disabled={!canRun(command, parts, locked)} onClick={() => run(command)}>
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
