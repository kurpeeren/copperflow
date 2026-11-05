// Toolbar pieces and the status line both canvases use.
import type { Point } from "./geometry"
import type { Gesture } from "./use-canvas-gestures"

const SNAP_STEPS = [0.1, 0.5, 1]

export function SnapSelect({ step, onChange, unit }: { step: number; onChange(step: number): void; unit: string }) {
  return (
    <label>
      Snap
      <select value={step} onChange={(e) => onChange(Number(e.target.value))}>
        {SNAP_STEPS.map((s) => (
          <option key={s} value={s}>
            {s}
            {unit}
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

/** The pointer position, what is under it, and how far a drag has moved the part. */
export function CanvasStatus({ cursor, unit, detail, gesture }: { cursor: Point | undefined; unit: string; detail: string | undefined; gesture: Gesture | undefined }) {
  return (
    <div className="canvas-status" aria-live="off">
      {cursor ? `${cursor.x.toFixed(2)}, ${cursor.y.toFixed(2)}${unit}` : ""}
      {detail && `  ${detail}`}
      {gesture?.kind === "drag" && gesture.moved && !gesture.blocker && `  Δ ${gesture.offset.x}, ${gesture.offset.y}`}
    </div>
  )
}
