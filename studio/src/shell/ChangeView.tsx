import { useEffect, useState } from "react"
import type { Point } from "../../../src/engine/model.js"
import { changeStore } from "../change-store"
import { changeKey, designFor, type ChangeViewState } from "../change-view"
import { ChangeCanvas } from "../pcb/ChangeCanvas"
import { ChangeBar } from "./change-bar"
import "./change-bar.css"

/** A change shown in place of the canvas: the bar over the board with the change marked. Escape or Close ends it. */
export function ChangeView({ state }: { state: ChangeViewState }) {
  const [focus, setFocus] = useState<{ at: Point; seq: number } | undefined>(undefined)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (changeKey(event.key) !== "close") return
      event.preventDefault()
      changeStore.close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  useEffect(() => setFocus(undefined), [state.request])
  const data = state.status === "ready" ? state.data : undefined
  const design = data ? designFor(data, state.mode) : undefined
  return (
    <div className="change-view">
      <ChangeBar state={state} onMode={changeStore.setMode} onClose={changeStore.close} onLine={(at) => setFocus((was) => ({ at, seq: (was?.seq ?? 0) + 1 }))} />
      {data?.onBoard && design && data.diff && <ChangeCanvas design={design} diff={data.diff} mode={state.mode} {...(focus ? { focus } : {})} />}
      {data?.onBoard && !design && <p className="empty">The circuit does not build on this side of the change, so there is no board to draw.</p>}
    </div>
  )
}
