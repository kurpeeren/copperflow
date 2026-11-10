// Edit → Fillet tracks (U) and Straighten tracks (Shift+U) on the PCB, from the menu bar, the track's context menu or the
// key: the tracks to change come from the selection (fillet.ts), the change goes out as one layout edit, drawn at once
// until its build lands, and the summary is told.
import { useEffect, useRef } from "react"
import type { Design } from "../api"
import type { Selection } from "../selection"
import type { CopperCommand } from "../shell/command-owners"
import { useCommands } from "../shell/commands"
import { keyAction, keyInput } from "./canvas-keys"
import type { CopperChange } from "./copper-gesture"
import { designWithSavedRadius, latestRulesWrite } from "./rules-writes"
import { shapeChange, shapeScope, type TrackShapeCommand } from "./fillet"

export interface TrackShapeInput {
  design: Design
  /** The shown build's start mark: a radius saved after it is not in the design yet (rules-writes.ts). */
  builtMark: number | undefined
  selection: Selection
  /** The locked parts: a track starting on one of their pads stays as it is. */
  lockedParts: ReadonlySet<string>
  /** A track is being drawn: the keys are the track tool's then. */
  routing: boolean
  /** Sends a copper change, drawn until its build lands; whether an earlier one is still on its way. */
  send(change: CopperChange): void
  busy(): boolean
  notify(text: string): void
}

/** Runs one of the two commands on the design's copper, asking first when it would change every track of the board. */
function runShape(input: TrackShapeInput, command: TrackShapeCommand): void {
  if (input.busy()) return input.notify("Wait for the last copper change to land, then try again.")
  const design = designWithSavedRadius(input.design, latestRulesWrite(), input.builtMark)
  const tracks = design.pcb.tracks.filter((track) => track.missingLayer === undefined)
  const scope = shapeScope(command, tracks, input.selection)
  if ("message" in scope) return input.notify(scope.message)
  if (scope.confirm !== undefined && !window.confirm(scope.confirm)) return
  const change = shapeChange(command, design, scope.ids, input.lockedParts)
  if ("message" in change) return input.notify(change.message)
  input.send(change)
  input.notify(change.summary)
}

export function useTrackShape(input: TrackShapeInput): void {
  const latest = useRef(input)
  latest.current = input
  useCommands({
    filletTracks: () => runShape(latest.current, "filletTracks"),
    straightenTracks: () => runShape(latest.current, "straightenTracks"),
  } satisfies Record<CopperCommand, () => void>)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (latest.current.routing || event.repeat) return
      const action = keyAction(keyInput(event), { view: "pcb" })?.action
      if (action !== "filletTracks" && action !== "straightenTracks") return
      event.preventDefault()
      runShape(latest.current, action)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}
