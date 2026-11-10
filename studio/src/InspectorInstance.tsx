// Properties of sub-sheets: an instance on its parent page (its sheet, connections and base), a part an instance made
// as the PCB shows it (R101 is R1 of PS1), a part of an open sheet (how many instances use it), and a sheet's port
// (its name, renamed with its local net, and its bus flag).
import { useEffect, useId, useState } from "react"
import type { Design, PartInfo } from "./api"
import type { Actions } from "./App"
import { connectionRefusal } from "../../src/core/connection-names.js"
import { Row, Section } from "./InspectorRows"
import { connectionsWith, instancePart, partsOfInstance, sheetUses, topInstance, usedLine } from "./pcb/instances"
import { sheetName } from "./pcb/sheet-names"
import type { SelectionChange } from "./selection"

/** A text field that commits on Enter or when it loses the focus, and goes back on Esc or a refused commit. */
function TextField({ id, value, disabled, placeholder, onCommit }: { id: string; value: string; disabled: boolean; placeholder?: string; onCommit(text: string): Promise<boolean> }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft.trim() === value) return
    void onCommit(draft.trim()).then((ok) => ok || setDraft(value))
  }
  return (
    <input
      id={id}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
        if (e.key === "Escape") setDraft(value)
      }}
    />
  )
}

interface InstanceProps {
  design: Design
  name: string
  editable: boolean
  actions: Actions
  onOpenSheet(file: string): void
  collapsed: ReadonlySet<string>
  toggle(title: string): void
}

/** An instance on its parent page: its sheet and how many instances use it, a field per port's connection, and its base. */
export function InstanceSection({ design, name, editable, actions, onOpenSheet, collapsed, toggle }: InstanceProps) {
  const instance = topInstance(design, name)
  const id = useId()
  if (!instance) return null
  const connect = (port: string, net: string) => {
    const refusal = net === "" ? undefined : connectionRefusal(instance.sheet, port, net, instance.ports.find((p) => p.name === port)?.bus === true)
    if (refusal !== undefined) {
      actions.notify(refusal)
      return Promise.resolve(false)
    }
    return actions.edit([{ kind: "setConnections", part: name, connections: connectionsWith(instance, port, net) }], `Connect ${name}.${port} to ${net === "" ? "nothing" : net}`)
  }
  const setBase = (text: string) => {
    const base = Number(text)
    if (!Number.isInteger(base) || base <= 0) {
      actions.notify("The base is a whole number above 0, such as 300")
      return Promise.resolve(false)
    }
    return actions.edit([{ kind: "setProps", part: name, props: { base } }], `Set ${name} base=${base}`)
  }
  return (
    <Section title="Sub-sheet" open={!collapsed.has("Sub-sheet")} onToggle={() => toggle("Sub-sheet")}>
      <Row label="Sheet">
        <span className="static">{usedLine(instance.sheet, sheetUses(design, instance.file))}</span>
      </Row>
      <div className="inspector-actions">
        <button onClick={() => onOpenSheet(instance.file)} title={`Open ${instance.file}`}>
          Open {instance.sheet}
        </button>
      </div>
      {instance.ports.map((port) => (
        <Row key={port.name} label={`${port.name}${port.bus ? " (bus)" : ""}`} htmlFor={`${id}-${port.name}`}>
          <TextField id={`${id}-${port.name}`} value={instance.connections[port.name] ?? ""} placeholder="not connected" disabled={!editable} onCommit={(net) => connect(port.name, net)} />
        </Row>
      ))}
      <Row label="base" htmlFor={`${id}-base`}>
        <TextField id={`${id}-base`} value={String(instance.base)} disabled={!editable} onCommit={setBase} />
      </Row>
    </Section>
  )
}

/** A part an instance made, as the PCB selects it: what it is in its sheet, and the ways to its instance and sheet. */
export function FlattenedPartView({ design, part, onSelect, onOpenSheet }: { design: Design; part: string; onSelect(change: SelectionChange): void; onOpenSheet(file: string): void }) {
  const from = instancePart(design, part)
  if (!from) return null
  const selectInstance = () => onSelect((current) => current.all(partsOfInstance(design, from.outer)))
  return (
    <div className="inspector">
      <header className="insp-header">
        <span>{part}</span>
      </header>
      <p className="note">
        {from.localId} of instance {from.instance} ({from.sheet}). {usedLine(from.sheet, sheetUses(design, from.file))}: change it in its sheet, and every instance changes with it.
      </p>
      <div className="inspector-actions">
        <button onClick={selectInstance}>Select the instance</button>
        <button onClick={() => onOpenSheet(from.file)} title={`Open ${from.file}`}>
          Open {from.sheet}
        </button>
      </div>
    </div>
  )
}

/** In an open sheet, what a part is: the sheet's, so every instance of it changes with it. */
export function SheetPartNote({ file, parentDesign }: { file: string; parentDesign: Design | undefined }) {
  const uses = parentDesign ? sheetUses(parentDesign, file) : undefined
  return <p className="note">{usedLine(sheetName(file), uses)}.</p>
}

/** A sheet's port: its name (renamed with the sheet's local net) and whether it is a bus port. */
export function PortSection({ part, editable, actions, collapsed, toggle }: { part: PartInfo; editable: boolean; actions: Actions; collapsed: ReadonlySet<string>; toggle(title: string): void }) {
  const id = useId()
  const bus = part.props["bus"]?.literal === true
  const rename = (to: string) => actions.edit([{ kind: "renamePort", from: part.name, to }], `Rename port ${part.name} to ${to}`)
  const setBus = (on: boolean) => actions.edit([{ kind: "setProps", part: part.name, props: { bus: on } }], `${on ? "Make" : "Unmake"} ${part.name} a bus port`)
  return (
    <Section title="Port" open={!collapsed.has("Port")} onToggle={() => toggle("Port")}>
      <Row label="Name" htmlFor={`${id}-name`}>
        <TextField id={`${id}-name`} value={part.name} disabled={!editable} onCommit={rename} />
      </Row>
      <Row label="Bus" htmlFor={`${id}-bus`}>
        <input id={`${id}-bus`} type="checkbox" checked={bus} disabled={!editable} onChange={(e) => void setBus(e.target.checked)} />
      </Row>
      <p className="hint">Drag its pin on a symbol of this sheet to move it along the box or to another side.</p>
    </Section>
  )
}
