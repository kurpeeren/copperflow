// Which kinds the Filter tab lets a click or a box pick. It lives in the workspace, above the canvas, so switching tabs
// or files (which remounts the canvas) keeps it for as long as Studio is open.
import { useCallback, useState } from "react"
import { ALL_PICKABLE, togglePickKind, type PickFilter, type PickKind } from "./pcb/pick-filter"

export function usePickFilter() {
  const [pickFilter, setFilter] = useState<PickFilter>(ALL_PICKABLE)
  const togglePickable = useCallback((kind: PickKind) => setFilter((now) => togglePickKind(now, kind)), [])
  return { pickFilter, togglePickable }
}
