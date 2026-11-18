// Toolbar pieces and the status line both canvases use.
import { blurAfterPointerClick } from "../shell/focus"
import type { Point } from "./geometry"
import { statusParts } from "./status"
import type { StepOption } from "./grid"
import type { Unit } from "./units"
import type { Gesture } from "./use-canvas-gestures"

/** One step is both the grid and the snap; the options are in mm on the PCB and in inches on the sheet (grid.ts). */
export function GridSelect({ step, options, onChange }: { step: number; options: readonly StepOption[]; onChange(step: number): void }) {
  return (
    <label>
      Grid
      <select value={step} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
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
  /** A Rotate press is held until the next build. */
  rotateHeld?: boolean
  /** Snap is off. */
  snap?: boolean
}

/** Zoom, the pointer position (and the PCB unit), how far a drag has moved the part, and what is under the pointer. */
export function CanvasStatus({ cursor, zoom, unit, onToggleUnit, detail, gesture, rotateHeld, snap }: StatusProps) {
  const { position, drag, notice, snap: snapNotice } = statusParts({ cursor, zoom, unit, gesture, rotateHeld, snap })
  return (
    <div className="canvas-status" aria-live="off">
      <span>{position}</span>
      {unit && (
        <button className="unit-toggle" onClick={(e) => {
            onToggleUnit?.()
            blurAfterPointerClick(e)
          }} onPointerDown={(e) => e.stopPropagation()} title="Switch between mm and mil (Q)">
          {unit}
        </button>
      )}
      {drag && <span>{`  ${drag}`}</span>}
      {detail && <span>{`  ${detail}`}</span>}
      {snapNotice && <span>{`  ${snapNotice}`}</span>}
      {notice && <span>{`  ${notice}`}</span>}
    </div>
  )
}

/**
 * The armed tool's hint over the canvas: a status region that is always there, so a screen reader announces each new
 * hint; with no hint it is empty and draws nothing.
 */
export function CanvasHint({ hint }: { hint: string | undefined }) {
  return (
    <div className="canvas-top">
      <div className="canvas-hint" role="status">
        {hint ?? ""}
      </div>
    </div>
  )
}
