import { buildDesign, type Design } from "../../src/engine/design.js"
import type { Violation } from "../../src/engine/checks/violation.js"
import { routeConnection, type ConnectionResult } from "../../src/engine/router/connect.js"
import type { RoutedCopper } from "../../src/engine/router/path.js"

type Files = Readonly<Record<string, string>>

/** The copper checks of stage 4, and the findings from resolving copper (shorts, floating copper, mismatched nets). */
export const COPPER_CODES = ["copper-clearance", "copper-edge", "copper-keepout", "track-width", "via-drill", "via-ring", "short", "floating", "mismatch", "copper-layer"]

const layoutPath = (main: string) => main.replace(/\.circuit\.tsx$/, ".circuit.layout.json")

/** The routed copper as layout file lines, ids counting on from `first`, made by the router. */
export function layoutLines(copper: RoutedCopper, first = 1): string {
  const id = (prefix: string, i: number) => `${prefix}${String(first + i).padStart(4, "0")}`
  const tracks = copper.tracks.map((track, i) => ({ t: "track", id: id("t", i), net: copper.net, ...track, locked: false, by: "router" }))
  const vias = copper.vias.map((via, i) => ({ t: "via", id: id("v", i), net: copper.net, ...via, locked: false, by: "router" }))
  return [...tracks, ...vias].map((record) => `${JSON.stringify(record)}\n`).join("")
}

/** Routes one connection of the built design. */
export function routeIn(design: Design, from: string, to: string): ConnectionResult {
  return routeConnection({ layout: design.pcb, rules: design.rules, nets: design.circuit.nets }, from, to)
}

export interface Checked {
  before: Design
  after: Design
  /** Violations the routed copper added, apart from the count of unrouted connections. */
  added: Violation[]
  copper: Violation[]
}

/** Builds the design again with the routed copper added to its layout file, and runs every check. */
export function checkRouted(files: Files, main: string, copper: RoutedCopper, first = 1): Checked {
  const before = buildDesign(files, main)
  const existing = files[layoutPath(main)] ?? ""
  const after = buildDesign({ ...files, [layoutPath(main)]: existing + layoutLines(copper, first) }, main)
  const known = new Set(before.violations.map((v) => v.id))
  const added = after.violations.filter((v) => !known.has(v.id) && v.code !== "unrouted")
  return { before, after, added, copper: after.violations.filter((v) => COPPER_CODES.includes(v.code)) }
}
