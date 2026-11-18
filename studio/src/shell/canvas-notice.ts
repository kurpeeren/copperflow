// What the canvas area says while there is no design to draw: a start screen when the project has no circuit file,
// the build's error when it failed, or that the circuit is being built. Plain TypeScript.
import type { BuildState } from "../api.js"

export const NO_CIRCUIT_TEXT = "This folder has no circuit yet."
export const AGENT_LINE = "An agent connected to this folder can make one too."
export const BUILDING_TEXT = "Building the circuit…"
const FAILED_TEXT = "The build failed."

export type CanvasNotice = { kind: "start" } | { kind: "text"; text: string } | { kind: "none" }

export interface NoticeInput {
  /** The project's circuit files, once the server has listed them; undefined before. */
  files: readonly string[] | undefined
  build: BuildState
  /** Why the circuit files could not be listed, if that failed. */
  listError?: string
}

/** Whether the project has been listed and holds no circuit file at all. */
export const hasNoCircuit = (files: readonly string[] | undefined): boolean => files !== undefined && files.length === 0

export function canvasNotice({ files, build, listError }: NoticeInput): CanvasNotice {
  if (build.design) return { kind: "none" }
  if (files === undefined && listError !== undefined) return { kind: "text", text: listError }
  if (hasNoCircuit(files)) return { kind: "start" }
  if (build.status === "failed") return { kind: "text", text: build.error ?? FAILED_TEXT }
  return { kind: "text", text: BUILDING_TEXT }
}

/** The bottom panel's DRC tab while nothing is built: the same words as the canvas, in one line. */
export function bottomNotice(input: NoticeInput): string | undefined {
  const notice = canvasNotice(input)
  if (notice.kind === "start") return NO_CIRCUIT_TEXT
  return notice.kind === "text" ? notice.text : undefined
}
