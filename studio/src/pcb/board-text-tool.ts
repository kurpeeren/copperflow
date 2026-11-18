// Place → Text on the PCB as plain data: armed, the tool waits for a click on the board; the click asks for the words
// at the snapped point; Enter places a `<silkscreentext>` there on the working layer's side, at the default height, as
// one edit. Esc closes the field first, then puts the tool away. The words and the place are held to the engine's own
// limits (engine/silk-text.ts, core/silk-text-edits.ts), so a refusal is told before anything is sent. Plain
// TypeScript with .js imports, so the tests run it.
import type { BoardBox, Edit } from "../../../src/core/types.js"
import { silkWordsProblem } from "../../../src/engine/silk-text.js"
import { AI_LOCK_MESSAGE } from "../ai-lock.js"
import { snapPoint, type Point } from "./geometry.js"
import type { ActiveLayer } from "./layers.js"

/** The armed tool: `at` is where the field asking for the words is, once the board was clicked. */
export interface BoardTextState {
  readonly at?: Point
}

export const ARMED_BOARD_TEXT: BoardTextState = {}

export const BOARD_TEXT_HINT = "Click on the board to place text (Esc cancels)"
const TYPING_HINT = "Type the text; Enter places it, Esc cancels"

/** Positions are written to a micrometre, as the other board items are. */
const DIGITS = 1e3
const round = (value: number) => Math.round(value * DIGITS) / DIGITS

/** A click at `world`: the field opens at the point, on the grid while Snap is on. */
export function boardTextPress(world: Point, step: number, snap: boolean): BoardTextState {
  const at = snap ? snapPoint(world, step) : world
  return { at: { x: round(at.x), y: round(at.y) } }
}

/** Esc: an open field closes and the tool stays armed; with no field open the tool is put away (null). */
export const boardTextCancel = (state: BoardTextState): BoardTextState | null => (state.at ? ARMED_BOARD_TEXT : null)

export const boardTextHint = (state: BoardTextState | null): string | undefined => (state === null ? undefined : state.at ? TYPING_HINT : BOARD_TEXT_HINT)

/** The silkscreen a new text goes on: the bottom while a bottom layer is the working layer, else the top. */
export const boardTextSide = (active: ActiveLayer): "top" | "bottom" => (active === "bottom" ? "bottom" : "top")

const offBoard = (at: Point, box: BoardBox | undefined): boolean => box !== undefined && (at.x < box.minX || at.x > box.maxX || at.y < box.minY || at.y > box.maxY)

/** The edit that places the confirmed words at `at`, or why it cannot be placed. */
export function boardTextPlacement(words: string, at: Point, active: ActiveLayer, box: BoardBox | undefined): { edit: Extract<Edit, { kind: "addSilkText" }>; summary: string } | { message: string } {
  const text = words.trim()
  const problem = silkWordsProblem(text)
  if (problem) return { message: `Not placed: ${problem}` }
  if (offBoard(at, box)) return { message: "Not placed: the click is off the board; click inside the board outline" }
  const layer = boardTextSide(active)
  return { edit: { kind: "addSilkText", text, x: at.x, y: at.y, layer }, summary: `add silkscreen text "${text}" on the ${layer}` }
}

/** With the AI lock closed, Enter keeps the field and says so in the lock's words. */
export const boardTextLockProblem = (closed: boolean): string | undefined => (closed ? AI_LOCK_MESSAGE : undefined)

/** The text new since the edit was sent (`before`: the ids then), once a build has it. */
export function newTextAfterBuild(before: ReadonlySet<string>, now: readonly string[]): string | undefined {
  return now.find((id) => !before.has(id))
}
