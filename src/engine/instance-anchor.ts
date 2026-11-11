// Where auto-placement starts for the parts of a sub-sheet instance: at the nearest instance around the part that
// has a position in that view, else together as one block of the outermost instance. Shared by the schematic and the PCB.
import type { Circuit, Component, Point, SheetInstance } from "./model.js"

export type View = "sch" | "pcb"

/** A group of parts placed together: `key` is "" for the circuit's own parts, else an instance path. */
export interface AnchorGroup {
  key: string
  /** The instance's position in the view; absent when the group is placed as one block where the rules put it. */
  anchor?: Point
  parts: Component[]
}

const positionOf = (instance: SheetInstance | undefined, view: View): Point | undefined => {
  const at = view === "sch" ? instance?.sch : instance?.pcb
  return at ? { x: at.x, y: at.y } : undefined
}

/** The paths from an instance path outwards: "A/B/C", "A/B", "A". */
function outwards(path: string): string[] {
  const segments = path.split("/")
  return segments.map((_, index) => segments.slice(0, segments.length - index).join("/"))
}

/** The group a part is placed with. */
function groupOf(component: Component, byPath: ReadonlyMap<string, SheetInstance>, view: View): { key: string; anchor?: Point } {
  if (component.instance === undefined) return { key: "" }
  const paths = outwards(component.instance)
  for (const path of paths) {
    const anchor = positionOf(byPath.get(path), view)
    if (anchor) return { key: path, anchor }
  }
  return { key: paths[paths.length - 1] ?? component.instance }
}

/**
 * The turn an instance gives the parts inside it: that of the nearest instance on its path (itself first) that writes
 * a board position, which records the turns of those round it; none when no instance on the path writes one.
 */
export function frameTurn(instances: readonly SheetInstance[], path: string): number {
  for (let at: string | undefined = path; at; at = at.includes("/") ? at.slice(0, at.lastIndexOf("/")) : undefined) {
    const placed = instances.find((instance) => instance.path === at)?.pcb
    if (placed) return placed.rotation
  }
  return 0
}

/** The parts in groups, in the order given: the circuit's own parts first, then each instance's as first met. */
export function anchorGroups(circuit: Circuit, parts: readonly Component[], view: View): AnchorGroup[] {
  const byPath = new Map((circuit.instances ?? []).map((instance) => [instance.path, instance]))
  const groups = new Map<string, AnchorGroup>([["", { key: "", parts: [] }]])
  for (const part of parts) {
    const { key, anchor } = groupOf(part, byPath, view)
    const group = groups.get(key) ?? { key, ...(anchor ? { anchor } : {}), parts: [] }
    groups.set(key, { ...group, parts: [...group.parts, part] })
  }
  return [...groups.values()].filter((group) => group.parts.length > 0)
}
