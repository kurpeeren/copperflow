import type { PartInfo } from "../core/index.js"
import type { Circuit, Component, SheetInstance } from "../engine/model.js"

/** What the compact summary reads from the engine's design when a circuit uses sub-sheets. */
export type Flattened = Pick<Circuit, "components" | "nets" | "instances">

/** A circuit file imports a sub-sheet when one of its imports names a `.sheet` file. */
export const importsSheet = (source: string): boolean => /\.sheet(\.tsx)?$/.test(source)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** `PS1 PowerStage base 100: VIN=VBUS VOUT=V3_3 GND=GND, 4 parts`; a port left unconnected shows "(open)". */
export function instanceLine(instance: SheetInstance, locked: boolean): string {
  const ports = instance.ports.map((port) => `${port.name}=${instance.connections[port.name] ?? "(open)"}`).join(" ")
  const head = `${instance.path} ${instance.sheet} base ${instance.base}: ${ports === "" ? "no ports" : ports}, ${plural(instance.parts.length, "part")}`
  return locked ? `${head} [LOCKED]` : head
}

/** `C101 capacitor 1uF 0402 in PS1 as C1`: a part an instance made, by its flattened designator. */
export function flatPartLine(component: Component): string {
  const where = component.instance === undefined ? "" : `in ${component.instance} as ${component.localId ?? component.id}`
  return [component.id, component.kind, component.value, component.footprint, where].filter(Boolean).join(" ")
}

const within = (path: string | undefined, top: string): boolean => path === top || path?.startsWith(`${top}/`) === true

/**
 * The part lines of a circuit with sub-sheets: each part of the file as `partLine` writes it, except an instance,
 * which becomes its line, the lines of the instances inside it, then the lines of every part it made.
 */
export function partLinesWithSheets(parts: readonly PartInfo[], flat: Flattened, locked: ReadonlySet<string>, partLine: (part: PartInfo) => string): string[] {
  const instances = flat.instances ?? []
  return parts.flatMap((part) => {
    const own = instances.filter((instance) => within(instance.path, part.name))
    if (own.length === 0) return [partLine(part)]
    const made = flat.components.filter((component) => within(component.instance, part.name)).map(flatPartLine)
    return [...own.map((instance) => instanceLine(instance, locked.has(instance.path))), ...made]
  })
}

/** How many parts the flattened circuit has, and how many instances. */
export function flatCounts(flat: Flattened): { parts: number; instances: number } {
  return { parts: flat.components.length, instances: (flat.instances ?? []).length }
}
