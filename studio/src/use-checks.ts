// The DRC tab's state: its rows and counts, the rings for each canvas, the row picked last and
// the camera focus it asks for, and the panel opening by itself when a build first reports errors.
// What these mean is decided in checks-list.ts and checks-panel-state.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { BuildState, RouteEvent } from "./api"
import { checkCounts, checkRows, markersFor, type CheckRow } from "./checks-list"
import { checkPick, opensOnBuild, type FocusRequest } from "./checks-panel-state"
import type { View } from "./pcb/positions"

interface ChecksInput {
  file: string | undefined
  build: BuildState
  /** The last Route → Autoroute run's news: its unrouted connections join the rows. */
  route: RouteEvent | undefined
  onTab(view: View): void
  onSelect(part: string): void
  /** Selects these tracks and vias, and these copper pours and holes, alone. */
  onSelectCopper(ids: readonly string[], board: readonly string[]): void
  onOpen(): void
}

export function useChecks({ file, build, route, onTab, onSelect, onSelectCopper, onOpen }: ChecksInput) {
  const design = build.design
  const rows = useMemo(() => (design ? checkRows(design, route) : []), [design, route])
  const counts = useMemo(() => checkCounts(rows), [rows])
  const markers = useMemo(() => ({ pcb: markersFor(rows, "pcb"), schematic: markersFor(rows, "schematic") }), [rows])
  const [active, setActive] = useState<string | null>(null)
  const [focus, setFocus] = useState<FocusRequest | null>(null)
  useAutoOpen(file, build, counts.errors, onOpen)
  const pick = useCallback(
    (row: CheckRow) => {
      const step = checkPick(row)
      setActive(row.id)
      if (step.tab) onTab(step.tab)
      if (step.focus) setFocus(step.focus)
      if (step.select) onSelect(step.select)
      if (step.selectCopper) onSelectCopper(step.selectCopper, step.selectBoard ?? [])
    },
    [onTab, onSelect, onSelectCopper],
  )
  const focused = useCallback(() => setFocus(null), [])
  return { rows, counts, markers, active, focus, pick, focused, requestFocus: setFocus }
}

/** Calls onOpen when a finished build has errors and the one before it had none. A failed build keeps the old design and is skipped. */
function useAutoOpen(file: string | undefined, build: BuildState, errors: number, onOpen: () => void): void {
  const previous = useRef<number | undefined>(undefined)
  useEffect(() => {
    previous.current = undefined
  }, [file])
  const finished = build.status === "done" ? build.finishedAt : undefined
  useEffect(() => {
    if (finished === undefined) return
    if (opensOnBuild(previous.current, errors)) onOpen()
    previous.current = errors
  }, [finished, errors, onOpen])
}
