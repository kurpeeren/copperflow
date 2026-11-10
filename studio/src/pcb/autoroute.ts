// What Route → Autoroute selection, Autoroute net and Unroute ask the server for, from the selection, the highlighted
// net and the built copper, or why there is nothing to ask. Pure, so the tests run it without a DOM.
import { unrouteEdits } from "../../../src/core/unroute.js"
import type { Design } from "../../../src/engine/design.js"
import type { RouteScope } from "../../../src/studio/route-events.js"
import { instancePart, partsOfInstance, topInstance } from "./instances.js"

/** Why a command has nothing to do, for the note. */
export interface Refusal {
  message: string
}

/**
 * Autoroute selection: a sub-sheet instance (its symbol, or every part of it) routes as that instance, so its routes
 * are copied to the other instances of its sheet; other parts route their own connections.
 */
export function selectionScope(design: Design | undefined, names: readonly string[]): RouteScope | Refusal {
  if (names.length === 0) return { message: "Select parts, or a sub-sheet instance, to route their connections." }
  const top = names.length === 1 ? topInstance(design, names[0] as string) : undefined
  if (top) return { kind: "instance", instance: top.path }
  const outers = new Set(names.map((name) => instancePart(design, name)?.outer))
  const [outer] = outers
  if (outers.size === 1 && outer !== undefined) {
    const parts = partsOfInstance(design, outer)
    if (parts.length === names.length && parts.every((part) => names.includes(part))) return { kind: "instance", instance: outer }
  }
  return { kind: "parts", parts: [...names] }
}

/** Autoroute net: the net the Nets panel's row (or Highlight net) highlights. */
export function netScope(highlight: readonly string[]): RouteScope | Refusal {
  if (highlight.length === 0) return { message: "Click a net in the Nets panel to highlight it, then Autoroute net." }
  return { kind: "nets", nets: [...highlight] }
}

/** Unroute: the selected copper the router made (ids), or with no copper selected all of it (no ids). */
export function unrouteRequest(design: Design | undefined, copper: readonly string[]): { ids?: string[] } | Refusal {
  if (!design) return { message: "Wait for the build to finish, then try again." }
  if (copper.length === 0) return unrouteEdits(design.pcb).length === 0 ? { message: "The board has no unlocked router copper to remove." } : {}
  if (unrouteEdits(design.pcb, copper).length === 0) return { message: "None of the selected copper was made by the router and unlocked; Unroute removes only that." }
  return { ids: [...copper] }
}
