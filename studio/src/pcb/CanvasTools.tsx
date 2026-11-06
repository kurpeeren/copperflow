// Toolbar pieces and the status line both canvases use.
import type { Point } from "./geometry"
import { statusParts } from "./status"
import { snapLabel, type Unit } from "./units"
import type { Gesture } from "./use-canvas-gestures"

const SNAP_STEPS = [0.1, 0.5, 1]

/** A clicked button gives up focus, so Space rotates the part instead of pressing the button again. Put on the toolbar, after the buttons' own handlers. */
export function blurButton(event: { target: EventTarget }): void {
  if (event.target instanceof HTMLElement) event.target.closest("button")?.blur()
}

/** The snap steps are in mm (sheet units on the schematic, which has no `unit`); only their labels follow the unit. */
export function SnapSelect({ step, onChange, unit }: { step: number; onChange(step: number): void; unit: Unit | undefined }) {
  return (
    <label>
      Snap
      <select value={step} onChange={(e) => onChange(Number(e.target.value))}>
        {SNAP_STEPS.map((s) => (
          <option key={s} value={s}>
            {unit ? snapLabel(s, unit) : s}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Shown only while the view has auto-placed parts. */
export function KeepButton({ show, onKeep, title }: { show: boolean; onKeep(): void; title: string }) {
  if (!show) return null
  return (
    <>
      <span className="tool-divider" aria-hidden="true" />
      <button onClick={onKeep} title={title}>
        Keep these positions
      </button>
    </>
  )
}

interface StatusProps {
  cursor: Point | undefined
  /** Camera scale, for the zoom readout. */
  zoom: number | undefined
  /** The PCB's unit, shown as a button that switches it; undefined on the schematic. */
  unit?: Unit
  onToggleUnit?(): void
  detail: string | undefined
  gesture: Gesture | undefined
}

/** Zoom, the pointer position (and the PCB unit), how far a drag has moved the part, and what is under the pointer. */
export function CanvasStatus({ cursor, zoom, unit, onToggleUnit, detail, gesture }: StatusProps) {
  const { position, drag } = statusParts({ cursor, zoom, unit, gesture })
  return (
    <div className="canvas-status" aria-live="off">
      <span>{position}</span>
      {unit && (
        <button className="unit-toggle" onClick={(e) => {
            onToggleUnit?.()
            blurButton(e)
          }} onPointerDown={(e) => e.stopPropagation()} title="Switch between mm and mil (Q)">
          {unit}
        </button>
      )}
      {drag && <span>{`  ${drag}`}</span>}
      {detail && <span>{`  ${detail}`}</span>}
    </div>
  )
}
