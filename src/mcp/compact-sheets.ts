import type { PartInfo } from "../core/index.js"
import type { Circuit, Component, SheetInstance } from "../engine/model.js"

/** What the compact summary reads from the engine's design when a circuit uses sub-sheets. */
export type Flattened = Pick<Circuit, "components" | "nets" | "connections" | "instances">

/** A circuit file imports a sub-sheet when one of its imports names a `.sheet` file. */
export const importsSheet = (source: string): boolean => /\.sheet(\.tsx)?$/.test(source)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/**
 * `PS1 PowerStage base 100: VIN=VBUS VOUT=V3_3 GND=GND, 4 parts`; a port left unconnected shows "(open)". The base is
 * the one its designators carry, so an instance inside another shows the outer bases added.
 */
export function instanceLine(instance: SheetInstance, locked: boolean): string {
  const ports = instance.ports.map((port) => `${port.name}=${instance.connections[port.name] ?? "(open)"}`).join(" ")
  const head = `${instance.path} ${instance.sheet} base ${instance.designatorBase}: ${ports === "" ? "no ports" : ports}, ${plural(instance.parts.length, "part")}`
  return locked ? `${head} [LOCKED]` : head
}

/** `C101 capacitor 1uF 0402 in PS1 as C1`: a part an instance made, by its flattened designator. */
export function flatPartLine(component: Component): string {
  const where = component.instance === undefined ? "" : `in ${component.instance} as ${component.localId ?? component.id}`
  return [component.id, component.kind, component.value, component.footprint, where].filter(Boolean).join(" ")
}

/**
 * The part lines of a circuit with sub-sheets: the file's own parts as `partLine` writes them (an instance's element
 * is not one), then each instance of the design, outer before inner, with the parts it holds directly. Instances
 * that an ordinary component makes are listed too, since they come from the design.
 */
export function partLinesWithSheets(parts: readonly PartInfo[], flat: Flattened, locked: ReadonlySet<string>, partLine: (part: PartInfo) => string): string[] {
  const instances = flat.instances ?? []
  const own = parts.filter((part) => !instances.some((instance) => instance.path === part.name)).map(partLine)
  const made = instances.flatMap((instance) => [
    instanceLine(instance, locked.has(instance.path)),
    ...flat.components.filter((component) => component.instance === instance.path).map(flatPartLine),
  ])
  return [...own, ...made]
}

/** How many parts the flattened circuit has, and how many instances. */
export function flatCounts(flat: Flattened): { parts: number; instances: number; traces: number } {
  return { parts: flat.components.length, instances: (flat.instances ?? []).length, traces: flat.connections.length }
}
