// The Find state: the find box (open, its text and the focus request), the last search, and what a result row does.
// What matches and what a click changes is decided in find.ts.
import { useCallback, useEffect, useMemo, useState } from "react"
import type { CircuitData, Design, LibraryPart } from "./api"
import type { FocusRequest } from "./checks-panel-state"
import { findNets, findPick, findResults, type FindRow } from "./find"
import type { Highlight } from "./pcb/highlight"
import type { View } from "./pcb/positions"
import type { SelectionChange } from "./selection"

interface FindInput {
  file: string | undefined
  circuit: CircuitData | undefined
  /** The library parts, whose MPN and title are searched for the parts placed from them. */
  library: readonly LibraryPart[]
  design: Design | undefined
  view: View
  onSelect(change: SelectionChange): void
  onHighlight(nets: Highlight): void
  requestFocus(request: FocusRequest): void
  /** Shows the Find Results tab. */
  openResults(): void
}

interface Box {
  open: boolean
  text: string
  /** Counts the requests to focus the field, so a second Ctrl+F is seen as new. */
  seq: number
}

const CLOSED: Box = { open: false, text: "", seq: 0 }

export function useFind({ file, circuit, library, design, view, onSelect, onHighlight, requestFocus, openResults }: FindInput) {
  const [box, setBox] = useState<Box>(CLOSED)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const parts = circuit?.model.parts
  const rows = useMemo(() => (query === null ? [] : findResults(query, parts ?? [], design ? findNets(design) : [], library)), [query, parts, design, library])
  // Results of another file are not this file's.
  useEffect(() => {
    setQuery(null)
    setActive(null)
  }, [file])
  const open = useCallback(() => setBox((current) => ({ ...current, open: true, seq: current.seq + 1 })), [])
  const close = useCallback(() => setBox((current) => ({ ...current, open: false })), [])
  const setText = useCallback((text: string) => setBox((current) => ({ ...current, text })), [])
  const search = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (trimmed === "") return
      setQuery(trimmed)
      setActive(null)
      openResults()
    },
    [openResults],
  )
  const pick = useCallback(
    (row: FindRow) => {
      const step = findPick(row, design, view)
      setActive(row.id)
      if (step.select) {
        const name = step.select
        onSelect((current) => current.only(name))
      }
      if (step.focus) requestFocus(step.focus)
      if (step.highlight) onHighlight(step.highlight)
    },
    [design, view, onSelect, onHighlight, requestFocus],
  )
  return { box, open, close, setText, search, results: { query, rows, active, pick } }
}

export type FindState = ReturnType<typeof useFind>
export type FindResultsProps = FindState["results"]
