import { useId, useState, type FormEvent } from "react"
import { gridStepOptions } from "../pcb/grid"
import type { Unit } from "../pcb/units"
import type { SystemSettings } from "./system-settings"
import type { ThemeName } from "./theme-state"

/** What Settings → System shows and writes. */
export interface SystemPanel {
  settings: SystemSettings
  apply(settings: SystemSettings): void
}

/** Settings → System: theme, the PCB's unit, each document's starting Grid step and hover labels, kept per browser. */
export function SystemForm({ panel, onClose }: { panel: SystemPanel; onClose(): void }) {
  const [draft, setDraft] = useState<SystemSettings>(panel.settings)
  const id = useId()
  const set = <K extends keyof SystemSettings>(key: K, value: SystemSettings[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    panel.apply(draft)
    onClose()
  }
  return (
    <form className="rules-form system-form" onSubmit={submit}>
      <label htmlFor={`${id}-theme`}>Theme</label>
      <select id={`${id}-theme`} value={draft.theme} onChange={(event) => set("theme", event.target.value as ThemeName)}>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
      <label htmlFor={`${id}-unit`}>PCB unit</label>
      <select id={`${id}-unit`} value={draft.unit} onChange={(event) => set("unit", event.target.value as Unit)}>
        <option value="mm">mm</option>
        <option value="mil">mil</option>
      </select>
      <label htmlFor={`${id}-sheet`}>Schematic grid</label>
      <select id={`${id}-sheet`} value={draft.grid.schematic} onChange={(event) => set("grid", { ...draft.grid, schematic: Number(event.target.value) })}>
        {gridStepOptions("schematic").map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-pcb`}>PCB grid</label>
      <select id={`${id}-pcb`} value={draft.grid.pcb} onChange={(event) => set("grid", { ...draft.grid, pcb: Number(event.target.value) })}>
        {gridStepOptions("pcb", draft.unit).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <label>
        <input type="checkbox" checked={draft.hoverLabels} onChange={(event) => set("hoverLabels", event.target.checked)} /> Hover labels
      </label>
      <p>Kept in this browser. The grid steps are where each document starts; the Grid select still changes them.</p>
      <button type="submit">Save</button>
    </form>
  )
}
