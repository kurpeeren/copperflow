// Where a file's sub-sheet instances sit in the designator numbers, read from the files alone, with the engine's rule
// (src/engine/sheets.ts, Bases): a written base, else the next default after the spans written before it; a sheet
// spans 100 plus the spans of the instances inside it.
import { posix } from "node:path"
import { BASE_STEP, withBase } from "../engine/sheets.js"
import { scanCircuit } from "./analyze.js"
import { readIfThere } from "./file-writes.js"
import { sheetFileIn } from "./selectors.js"
import type { CircuitModel } from "./types.js"
import { resolveInRoot } from "./workspace.js"

export interface PlacedInstance {
  name: string
  sheet: string
  base: number
  /** The base is written in the file, so it does not depend on the order of the instances. */
  written: boolean
  span: number
  /** The designators the instance makes, its base added. */
  designators: string[]
}

export interface SheetLayout {
  span: number
  /** The designators an instance of the sheet makes with base 0: its own parts, then those of the instances inside. */
  designators: string[]
}

/** The span and designators of a sheet file; a missing file or one that contains itself counts as one empty step (the engine reports it). */
export async function sheetLayout(root: string, file: string, seen: readonly string[] = []): Promise<SheetLayout> {
  if (seen.includes(file)) return { span: BASE_STEP, designators: [] }
  const text = await readIfThere(resolveInRoot(root, file))
  if (text === undefined) return { span: BASE_STEP, designators: [] }
  const model = scanCircuit(text).model
  const inside = await placeInstances(root, file, model, [...seen, file])
  const own = model.parts.filter((part) => part.tag !== "port" && sheetFileIn(model, part.name) === undefined).map((part) => part.name)
  return { span: BASE_STEP + inside.reduce((sum, instance) => sum + instance.span, 0), designators: [...own, ...inside.flatMap((instance) => instance.designators)] }
}

/** The instances a file (circuit or sheet) writes, in the order written, each with the base the engine gives it. */
export async function placeInstances(root: string, file: string, model: CircuitModel, seen: readonly string[] = [file]): Promise<PlacedInstance[]> {
  let next = BASE_STEP
  const placed: PlacedInstance[] = []
  for (const part of model.parts) {
    const sheetFile = sheetFileIn(model, part.name)
    if (sheetFile === undefined) continue
    const literal = part.props["base"]?.literal
    const written = typeof literal === "number"
    const base = written ? literal : next
    const layout = await sheetLayout(root, posix.join(posix.dirname(file), sheetFile), seen)
    if (!written || base >= next) next = base + layout.span
    placed.push({ name: part.name, sheet: part.tag, base, written, span: layout.span, designators: layout.designators.map((id) => withBase(id, base)) })
  }
  return placed
}

/**
 * Refuses a new instance whose base another instance has, or whose designators a part of the circuit or another
 * instance already has, as new_circuit does.
 */
export function checkNewInstance(name: string, sheet: string, base: number, layout: SheetLayout, placed: readonly PlacedInstance[], parts: readonly string[]): void {
  const sameBase = placed.find((other) => other.base === base)
  if (sameBase) throw new Error(`${name}: base ${base} is already ${sameBase.name}'s; give another base`)
  const own = new Set(parts)
  for (const local of layout.designators) {
    const id = withBase(local, base)
    if (own.has(id)) throw new Error(`${name} makes ${id} (${local} in ${sheet}), which is also a part of the circuit; give ${name} another base`)
    const other = placed.find((instance) => instance.designators.includes(id))
    if (other) throw new Error(`${name} makes ${id} (${local} in ${sheet}), which ${other.name} makes too; give ${name} another base`)
  }
}

/** The base after every instance's span: a new instance there makes no designator another one makes. */
export const nextFreeBase = (placed: readonly PlacedInstance[]): number =>
  placed.length === 0 ? BASE_STEP : Math.max(...placed.map((instance) => instance.base + instance.span))
