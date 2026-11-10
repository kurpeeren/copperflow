import type { CircuitModel } from "./types.js"

const CLASS_SELECTOR = /(?:^|[\s>])\.([A-Za-z_][\w-]*)/
const DOTTED_PORT = /^([A-Za-z_][\w-]*)\.[\w-]+$/

/**
 * Returns the part names referenced by a tscircuit port selector.
 * `.R1 > .pin1` and `R1.pin1` both reference R1; `net.GND` references no part.
 */
export function partsInSelector(selector: string): string[] {
  const names = new Set<string>()
  for (const piece of selector.split(",")) {
    const trimmed = piece.trim()
    if (trimmed.startsWith("net.")) continue
    const match = DOTTED_PORT.exec(trimmed) ?? CLASS_SELECTOR.exec(trimmed)
    if (match?.[1]) names.add(match[1])
  }
  return [...names]
}

/**
 * The sheet file a circuit's own instance comes from, read from the file alone: the instance's tag is an import
 * of a `.sheet` file. Unknown for an instance inside a sheet, which this file does not show.
 */
export function sheetFileIn(model: Pick<CircuitModel, "parts" | "imports">, instance: string): string | undefined {
  if (instance.includes("/")) return undefined
  const tag = model.parts.find((part) => part.name === instance)?.tag
  const source = model.imports.find((spec) => spec.local === tag)?.source
  if (source === undefined || !/\.sheet(\.tsx)?$/.test(source)) return undefined
  const file = source.replace(/^\.\//, "")
  return file.endsWith(".tsx") ? file : `${file}.tsx`
}
