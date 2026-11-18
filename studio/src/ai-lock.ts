// The AI lock: who is driving the board. Closed, the Studio writes nothing to the circuit, its layout, the rules or the
// history; looking, exporting, notes for the agent and part locks still work. The agent is never blocked by it. Pure.
import { ALIGN_COMMANDS } from "./pcb/align-rules.js"
import type { KeyActionName } from "./pcb/canvas-keys.js"
import { DRAW_COMMANDS } from "./pcb/draw-commands.js"
import type { GestureStart } from "./pcb/press.js"
import type { CommandId, CommandsOff } from "./shell/menus.js"

/** The status message for a blocked gesture or key, and the reason a disabled command gives. */
export const AI_LOCK_MESSAGE = "The AI lock is on. Open it to edit."

export interface AiLock {
  closed: boolean
  /** The person has made a change of their own since they last opened the lock. */
  editedSinceOpen: boolean
}

/** Who wrote a history entry. */
export type ChangeAuthor = "ai" | "human"

/** When a project opens: closed if the newest history entry is the agent's, otherwise open. */
export function startLock(newestAuthor: ChangeAuthor | undefined): AiLock {
  return { closed: newestAuthor === "ai", editedSinceOpen: false }
}

/** A click on the control. */
export function toggleLock(lock: AiLock): AiLock {
  return { closed: !lock.closed, editedSinceOpen: false }
}

/**
 * A new history entry: the agent's closes an open lock unless the person has changed something since opening it (they
 * are in the middle of something); the person's own is remembered. It never opens by itself.
 */
export function afterChange(lock: AiLock, author: ChangeAuthor): AiLock {
  if (lock.closed) return lock
  if (author === "human") return lock.editedSinceOpen ? lock : { ...lock, editedSinceOpen: true }
  return lock.editedSinceOpen ? lock : { ...lock, closed: true }
}

/** The menu and toolbar commands that change the circuit, its layout, the rules, pours, holes or the history. */
export const LOCKED_COMMANDS = [
  "undo",
  "redo",
  "delete",
  "replicateLayout",
  "makeSheet",
  "placeComponent",
  "wire",
  "netLabel",
  "groundFlag",
  "powerFlag",
  ...DRAW_COMMANDS,
  "singleRouting",
  "placeVia",
  "placePour",
  "placePourBoard",
  "placeHole",
  "autoplace",
  "autoplaceSelection",
  "autoplaceInstance",
  "fitBoard",
  "importBoardDxf",
  "importGraphic",
  "autoroute",
  "autorouteSelection",
  "autorouteNet",
  "unroute",
  "rotate",
  "rotateRight",
  "removeCorners",
  "filletTracks",
  "straightenTracks",
  "designRules",
  "tidySheet",
  "addPage",
  "renamePage",
  "deletePage",
  ...ALIGN_COMMANDS,
  "newCircuit",
  "paste",
  "noConnect",
  "junction",
  "annotate",
  "placementTransfer",
  "routingCorner",
  "flip",
  "footprintManager",
] as const satisfies readonly CommandId[]

/** While closed, each locked command is off with the lock's message; open, none is. */
export function lockedOff(closed: boolean): CommandsOff {
  return closed ? Object.fromEntries(LOCKED_COMMANDS.map((command) => [command, AI_LOCK_MESSAGE])) : {}
}

const LOCKED_KEYS: ReadonlySet<KeyActionName> = new Set<KeyActionName>([
  "wire",
  "route",
  "placeVia",
  "armNetLabel",
  ...DRAW_COMMANDS,
  "rotate",
  "openLibrary",
  "undo",
  "redo",
  "nudgeLeft",
  "nudgeRight",
  "nudgeUp",
  "nudgeDown",
  "delete",
  "removeCorner",
  "flipBend",
  "alignLeft",
  "distributeH",
  "filletTracks",
  "straightenTracks",
  "routingCorner",
  "flip",
  "paste",
  "junction",
  "placementTransfer",
])

/** Whether a key's action changes something, and so does nothing while the lock is closed. */
export function blocksKey(action: KeyActionName): boolean {
  return LOCKED_KEYS.has(action)
}

const LOCKED_GESTURES: ReadonlySet<GestureStart> = new Set<GestureStart>(["move", "moveGroup", "label", "text", "wireSegment", "wireCorner"])

/** Whether a canvas press starts a drag that changes something; panning, selecting, a note box and Fit area do not. */
export function blocksGesture(start: GestureStart): boolean {
  return LOCKED_GESTURES.has(start)
}

/** The server requests that write the circuit files, the layout file, the rules or the history. */
const WRITES: ReadonlySet<string> = new Set(["/api/edit", "/api/layout", "/api/undo", "/api/redo", "/api/rename-parts", "/api/make-sheet", "/api/route", "/api/autoplace", "/api/fit-board", "/api/import-board", "/api/import-graphic", "/api/unroute", "/api/rules", "/api/place", "/api/new-circuit"])

/** Whether a request writes, and so is not sent while the lock is closed. A GET (no body) or a preview never writes. */
export function blocksRequest(path: string, body: unknown): boolean {
  if (body === undefined) return false
  if (typeof body === "object" && body !== null && (body as { preview?: unknown }).preview === true) return false
  return WRITES.has(path.split("?")[0] ?? path)
}

/** What the control says: the state in large words, what a click does in small ones. */
export function lockLabel(closed: boolean): { title: string; hint: string } {
  return closed ? { title: "AI is driving", hint: "Unlock to edit" } : { title: "You are editing", hint: "Lock for the agent" }
}

/** Whether a menu, toolbar or context menu command may run: while closed, no locked command does. */
export function blocksCommand(command: CommandId): boolean {
  return (LOCKED_COMMANDS as readonly CommandId[]).includes(command)
}
