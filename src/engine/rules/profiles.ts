import type { FabricationProfile, NetClass } from "./schema.js"

/**
 * JLCPCB standard (not advanced) capabilities for rigid boards in 1 oz copper, read on 2026-11-06
 * from https://jlcpcb.com/capabilities/pcb-capabilities. Each field names the section it comes from:
 *
 * - track width and spacing: "Traces", "Min. track width and spacing (1 oz)"
 * - drill: "Drilling", "Drill Diameter" (smaller drills are an advanced option, so not used)
 * - annular ring: "Traces", "PTH annular ring". The page gives a recommended and an absolute
 *   minimum; the absolute minimum is used, because a limit is what a design check compares against
 * - board edge: "Outline", "Routed"
 * - hole to hole: "Drilling", "Pad Hole-to-Hole Spacing" (0.45 mm). The looser "Via Hole-to-Hole
 *   Spacing" (0.2 mm) is not used, so the field is safe for pads as well as vias
 * - silkscreen to pad: "Legend", "Pad To Silkscreen"
 *
 * The page lists no separate 4-layer column; its multilayer rows are used for 4 layers.
 */
const SOURCE_2 =
  "JLCPCB PCB Manufacturing & Assembly Capabilities, https://jlcpcb.com/capabilities/pcb-capabilities, read 2026-11-06; sections Traces, Drilling, Outline, Legend; rigid 2-layer, 1 oz"
const SOURCE_4 =
  "JLCPCB PCB Manufacturing & Assembly Capabilities, https://jlcpcb.com/capabilities/pcb-capabilities, read 2026-11-06; sections Traces, Drilling, Outline, Legend; multilayer rows for 4 layers, 1 oz"

export const DEFAULT_PROFILE = "jlcpcb-2layer"

export const PROFILES: Readonly<Record<string, FabricationProfile>> = {
  "jlcpcb-2layer": {
    name: "jlcpcb-2layer",
    source: SOURCE_2,
    copperLayers: 2,
    minTrackWidth: 0.1,
    minClearance: 0.1,
    minDrill: 0.15,
    minAnnularRing: 0.18,
    boardEdgeClearance: 0.2,
    minHoleToHole: 0.45,
    minSilkToPad: 0.15,
  },
  "jlcpcb-4layer": {
    name: "jlcpcb-4layer",
    source: SOURCE_4,
    copperLayers: 4,
    minTrackWidth: 0.09,
    minClearance: 0.09,
    minDrill: 0.15,
    minAnnularRing: 0.15,
    boardEdgeClearance: 0.2,
    minHoleToHole: 0.45,
    minSilkToPad: 0.15,
  },
}

/** copperflow's own conservative choice, above the profile minimums. A class field left out takes these values. */
export const DEFAULT_CLASS: NetClass = {
  name: "default",
  trackWidth: 0.25,
  clearance: 0.2,
  via: { drill: 0.3, diameter: 0.6 },
  patterns: [],
}
