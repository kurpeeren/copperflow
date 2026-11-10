// Sub-sheet instances as the Studio sees them: which instance a flattened part (R101) comes from, the parts of an
// instance for Select → "Select the instance", how many instances use a sheet for Properties, and the locks a
// locked instance puts on its parts. Pure, so the tests run it without a DOM.
import { withInstanceParts } from "../../../src/core/instance-locks.js"
import type { Design } from "../../../src/engine/design.js"
import type { SheetInstance } from "../../../src/engine/model.js"
import { sheetName } from "./sheet-names.js"

/** A part made by an instance, as Properties tells it: its local name, its instance, and the sheet that owns it. */
export interface InstancePart {
  part: string
  localId: string
  /** Its own instance's path, "PS1" or "PS1/D1". */
  instance: string
  /** The instance on the circuit itself that holds it, "PS1": the one that is selected, moved and locked. */
  outer: string
  sheet: string
  file: string
}

const instances = (design: Design | undefined): readonly SheetInstance[] => design?.circuit.instances ?? []

/** The instance on the circuit itself with this name; inner instances are the sheet's, not the circuit's. */
export function topInstance(design: Design | undefined, name: string): SheetInstance | undefined {
  return instances(design).find((instance) => instance.path === name && !instance.path.includes("/"))
}

/** Where a flattened part comes from, or undefined for the circuit's own part. */
export function instancePart(design: Design | undefined, part: string): InstancePart | undefined {
  const component = design?.circuit.components.find((candidate) => candidate.id === part)
  if (component?.instance === undefined) return undefined
  const own = instances(design).find((instance) => instance.path === component.instance)
  if (!own) return undefined
  const outer = component.instance.split("/")[0] ?? component.instance
  return { part, localId: component.localId ?? part, instance: own.path, outer, sheet: own.sheet, file: own.file }
}

/** The flattened parts of an instance, nested instances' included. */
export function partsOfInstance(design: Design | undefined, path: string): string[] {
  return [...(instances(design).find((instance) => instance.path === path)?.parts ?? [])]
}

/** How many instances on the circuit, nested ones included, are made from the sheet file. */
export function sheetUses(design: Design | undefined, file: string): number {
  return instances(design).filter((instance) => instance.file === file).length
}

/** "In PowerStage, used 2 times": what Properties says of a part a sheet owns. */
export function usedLine(sheet: string, uses: number | undefined): string {
  if (uses === undefined) return `In ${sheet}; every instance of it changes with it`
  return `In ${sheet}, used ${uses === 1 ? "once" : `${uses} times`}`
}

/**
 * Select → "Select the instance": the parts the selection holds, each replaced by every part of the instance on the
 * circuit that holds it, and an instance's symbol (on the schematic) by itself. Undefined when nothing selected is in
 * an instance.
 */
export function instanceSelection(design: Design | undefined, names: readonly string[]): string[] | undefined {
  const found = names.flatMap((name) => {
    const top = topInstance(design, name)
    if (top) return [top.path]
    const from = instancePart(design, name)
    return from ? [from.outer] : []
  })
  if (found.length === 0) return undefined
  const outers = [...new Set(found)]
  return outers.flatMap((outer) => partsOfInstance(design, outer))
}

/** An instance's connections with one port's changed: to a net, or (an empty name) left unconnected. */
export function connectionsWith(instance: Pick<SheetInstance, "connections">, port: string, net: string): Record<string, string> {
  const rest = Object.fromEntries(Object.entries(instance.connections).filter(([name]) => name !== port))
  return net === "" ? rest : { ...instance.connections, [port]: net }
}

/** The locked parts with the parts of each locked instance added (a locked instance locks all its parts). */
export function lockedWithInstances(locked: ReadonlySet<string>, design: Design | undefined): Set<string> {
  return withInstanceParts(locked, design?.circuit.instances)
}

/** Why a part an instance made may not be moved or changed in the open circuit: it is the sheet's, or its instance is locked. */
export function instancePartBlocker(design: Design | undefined, locked: ReadonlySet<string>, part: string): string | undefined {
  const from = instancePart(design, part)
  if (!from) return undefined
  if (locked.has(from.outer)) return `${part} is in ${from.outer}, which is locked`
  return `${part} is ${from.localId} of ${from.instance}; it is placed in ${from.file}, where every instance of ${sheetName(from.file)} shares it`
}
