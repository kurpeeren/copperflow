import type { SourceRef } from "./model.js"

export const Fragment = "#fragment"

export type ComponentFunction = (props: Record<string, unknown>) => unknown

export interface CfElement {
  type: string | ComponentFunction
  /** Everything the author wrote on the tag, without children. */
  props: Record<string, unknown>
  /** Flattened: arrays and fragments are spliced in; null, undefined and booleans are dropped. */
  children: unknown[]
  source?: SourceRef
}

interface JsxSource {
  fileName: string
  lineNumber: number
  columnNumber: number
}

type JsxFactory = (type: CfElement["type"], props: Record<string, unknown>, key?: unknown) => CfElement

export interface Runtime {
  jsx: JsxFactory
  jsxs: JsxFactory
  jsxDEV(type: CfElement["type"], props: Record<string, unknown>, key?: unknown, isStatic?: boolean, source?: JsxSource): CfElement
  Fragment: typeof Fragment
}

export function isElement(value: unknown): value is CfElement {
  return typeof value === "object" && value !== null && "type" in value && "props" in value && Array.isArray((value as CfElement).children)
}

function flattenChildren(value: unknown): unknown[] {
  if (value === null || value === undefined || typeof value === "boolean") return []
  if (Array.isArray(value)) return value.flatMap(flattenChildren)
  if (isElement(value) && value.type === Fragment) return value.children
  return [value]
}

/** Indexes where each line starts, so a line and column become a string offset. A CRLF counts as two characters. */
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1)
  return starts
}

export function createRuntime(files: Readonly<Record<string, string>>): Runtime {
  const startsByFile = new Map<string, number[]>()

  function locate(source: JsxSource | undefined): SourceRef | undefined {
    if (!source) return undefined
    const text = files[source.fileName]
    if (text === undefined) return undefined
    let starts = startsByFile.get(source.fileName)
    if (!starts) {
      starts = lineStarts(text)
      startsByFile.set(source.fileName, starts)
    }
    const lineStart = starts[source.lineNumber - 1]
    if (lineStart === undefined) return undefined
    return { file: source.fileName, line: source.lineNumber, column: source.columnNumber, offset: lineStart + source.columnNumber - 1 }
  }

  function jsxDEV(type: CfElement["type"], props: Record<string, unknown>, _key?: unknown, _isStatic?: boolean, source?: JsxSource): CfElement {
    const { children, ...rest } = props ?? {}
    const element: CfElement = { type, props: rest, children: flattenChildren(children) }
    const where = locate(source)
    return where ? { ...element, source: where } : element
  }

  const jsx: JsxFactory = (type, props, key) => jsxDEV(type, props, key)
  return { jsx, jsxs: jsx, jsxDEV, Fragment }
}
