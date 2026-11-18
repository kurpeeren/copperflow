// Place → Text on the PCB (the menu, the toolbar and Alt+T): one more canvas tool. Armed, a left click on the board
// opens the text field there; Enter places the words on the working layer's silkscreen as one history entry and the
// new text is selected once the build has it. Arming it puts the PCB's other tools away, and arming any of them puts
// it away; Esc or a right click puts it away too. While the AI lock is closed a click places nothing. The logic is in
// board-text-tool.ts; this hook holds the state.
import { useCallback, useEffect, useRef, useState } from "react"
import { lockGate } from "../ai-lock-gate.js"
import type { CircuitData, Design } from "../api"
import type { Actions } from "../App"
import type { SelectionChange } from "../selection"
import { useCommands } from "../shell/commands"
import type { TextCommand } from "../shell/command-owners"
import { ARMED_BOARD_TEXT, boardTextCancel, boardTextLockProblem, newTextAfterBuild, boardTextHint, boardTextPlacement, boardTextPress, type BoardTextState } from "./board-text-tool"
import { keyAction, keyInput } from "./canvas-keys"
import type { Point } from "./geometry"
import type { ActiveLayer } from "./layers"
import type { Press } from "./press"
import { useDisarmKey } from "./use-disarm-key"

const LEFT = 0
const RIGHT = 2

export interface BoardTextInput {
  design: Design
  circuit: CircuitData
  actions: Actions
  step: number
  snap: boolean
  activeLayer: ActiveLayer
  /** Another PCB tool is armed: the text tool steps aside. */
  othersArmed: boolean
  /** Puts the PCB's other tools away. */
  putOthersAway(): void
  onSelect(change: SelectionChange): void
}

/** The texts' ids in a design. */
const textIds = (design: Design): string[] => (design.pcb.silkTexts ?? []).map((text) => text.id)

/** What a placed text waits for: the ids before the edit, and the design shown when the edit was written. */
interface Waiting {
  before: ReadonlySet<string>
  shown: Design
}

/**
 * Selects the text a placement made: after the first build that follows the written edit, the text whose id was not
 * there before is selected, and the wait ends whether or not one appeared. `send` returns the wait's start, and its
 * `written` arms it (or drops it when the edit failed).
 */
function useSelectNewText(design: Design, onSelect: BoardTextInput["onSelect"]) {
  const [waiting, setWaiting] = useState<Waiting | null>(null)
  useEffect(() => {
    if (waiting === null || design === waiting.shown) return
    const made = newTextAfterBuild(waiting.before, textIds(design))
    if (made !== undefined) onSelect((current) => current.clear().onlyBoard(made))
    setWaiting(null)
  }, [design, waiting, onSelect])
  const latestDesign = useRef(design)
  latestDesign.current = design
  return useCallback((before: ReadonlySet<string>, ok: boolean) => setWaiting(ok ? { before, shown: latestDesign.current } : null), [])
}

/** Arming the tool puts the others away; another tool armed later puts this one away. */
function useStepAside(armed: boolean, othersArmed: boolean, putOthersAway: () => void, disarm: () => void): void {
  const putAway = useRef(putOthersAway)
  putAway.current = putOthersAway
  useEffect(() => {
    if (armed) putAway.current()
  }, [armed])
  const before = useRef(othersArmed)
  useEffect(() => {
    if (othersArmed && !before.current) disarm()
    before.current = othersArmed
  }, [othersArmed, disarm])
}

/** Alt+T on the PCB arms the tool, as the menu's Place → Text does. */
function useArmKey(arm: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (keyAction(keyInput(event), { view: "pcb" })?.action !== "drawText") return
      event.preventDefault()
      arm()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [arm])
}

/** Sends the confirmed words as one edit; the reason when they are refused before sending (the AI lock too). */
function place(input: BoardTextInput, at: Point, words: string, written: (before: ReadonlySet<string>, ok: boolean) => void): string | undefined {
  const placement = boardTextPlacement(words, at, input.activeLayer, input.circuit.model.boardBox)
  if ("message" in placement) return placement.message
  const locked = boardTextLockProblem(lockGate.closed())
  if (locked) return locked
  const before = new Set(textIds(input.design))
  void input.actions
    .edit([placement.edit], placement.summary)
    .catch((error: unknown) => {
      input.actions.notify(`Not written: ${error instanceof Error ? error.message : String(error)}`)
      return false
    })
    .then((ok) => written(before, ok))
  return undefined
}

export function useBoardTextTool(input: BoardTextInput) {
  const [state, setState] = useState<BoardTextState | null>(null)
  const latest = useRef(input)
  latest.current = input
  const arm = useCallback(() => setState(ARMED_BOARD_TEXT), [])
  const disarm = useCallback(() => setState(null), [])
  useCommands({ drawText: arm } satisfies Record<TextCommand, () => void>)
  useArmKey(arm)
  useStepAside(state !== null, input.othersArmed, input.putOthersAway, disarm)
  // Esc outside a text field: an open field closes, else the tool is put away; inside the field its own Esc does it.
  const cancel = useCallback(() => setState((now) => (now === null ? null : boardTextCancel(now))), [])
  useDisarmKey(state !== null, cancel)
  const selectWhenBuilt = useSelectNewText(input.design, input.onSelect)
  const press = (event: Press, world: Point): boolean => {
    if (state === null) return false
    if (event.button === RIGHT) {
      disarm()
      return true
    }
    if (event.button !== LEFT) return false
    if (!lockGate.refuses()) setState(boardTextPress(world, input.step, input.snap))
    return true
  }
  const at = state?.at
  const submit = (words: string): string | undefined => {
    if (!at) return undefined
    const problem = place(latest.current, at, words, selectWhenBuilt)
    if (problem === undefined) setState(ARMED_BOARD_TEXT)
    return problem
  }
  return { armed: state !== null, press, hint: boardTextHint(state), at, submit, cancel, disarm }
}
