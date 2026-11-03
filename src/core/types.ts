/** A value copperflow can read from and write back to source code. */
export type Literal = string | number | boolean

export interface PropInfo {
  /** The literal value, or undefined when the prop is an expression. */
  literal: Literal | undefined
  /** The attribute value exactly as written, e.g. `"5.1k"` or `{-4}`. */
  source: string
  editable: boolean
}

export interface PartInfo {
  name: string
  tag: string
  line: number
  props: Record<string, PropInfo>
  editable: boolean
  readonlyReason?: string
  /** Character offsets of the whole element in the source. */
  start: number
  end: number
}

export interface TraceInfo {
  from: string | undefined
  to: string | undefined
  props: Record<string, PropInfo>
  line: number
  editable: boolean
  readonlyReason?: string
  start: number
  end: number
}

export interface SkippedElement {
  tag: string
  line: number
  reason: string
}

export interface CircuitModel {
  parts: PartInfo[]
  traces: TraceInfo[]
  skipped: SkippedElement[]
  /** Offsets of the `<board>` element's closing tag, when there is one. */
  boardClose?: { start: number }
}

export type Edit =
  | { kind: "setProps"; part: string; props: Record<string, Literal> }
  | { kind: "removePart"; part: string }
  | { kind: "addTrace"; from: string; to: string; props?: Record<string, Literal> }
  | { kind: "removeTrace"; from: string; to: string }
