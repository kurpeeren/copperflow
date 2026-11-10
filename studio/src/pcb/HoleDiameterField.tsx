// Place → Hole's diameter field, under the tool's hint: each click places a hole of the diameter typed here (3.2 mm
// at first, for an M3 screw). What the field says is checked when a hole is placed (pour-tool.ts holeDiameter).
import { useId } from "react"
import "./hole-field.css"

export function HoleDiameterField({ value, onChange }: { value: string; onChange(value: string): void }) {
  const id = useId()
  return (
    <div className="hole-field" onPointerDown={(event) => event.stopPropagation()}>
      <label htmlFor={id}>Hole diameter (mm)</label>
      <input id={id} value={value} inputMode="decimal" spellCheck={false} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}
