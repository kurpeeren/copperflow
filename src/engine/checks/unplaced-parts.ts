import type { PcbLayout } from "../pcb.js"
import type { Violation } from "./violation.js"

/**
 * A part nobody has placed yet (auto-placed: the build put it somewhere so it can be drawn) has a position that means
 * nothing, so the findings that depend on where it is are left out until it has one; the `unplaced` warning says it.
 * Left out: the part against the board (edge, outline, keepouts), and the part against other parts (courtyards, silk,
 * pad clearance and hole spacing). What a footprint gets wrong on its own (its own pads too near each other) is kept.
 */

/** Findings about a part against the board: left out whenever they name an auto-placed part. */
const AGAINST_BOARD = new Set(["board-edge", "outside-board", "keepout"])
/** Findings between two parts: left out when they name an auto-placed part and anything of another part. */
const BETWEEN_PARTS = new Set(["courtyard-overlap", "silk-on-pad", "clearance", "hole-to-hole"])

/** "U1#15" and "U1" both name U1. */
const partOf = (item: string) => item.split("#")[0] ?? item

/** The violations without those that only the auto-placed parts' made-up positions produce; see the module comment. */
export function withoutUnplacedPositions(violations: readonly Violation[], layout: Pick<PcbLayout, "parts">): Violation[] {
  const auto = new Set(layout.parts.filter((part) => part.autoPlaced).map((part) => part.component))
  if (auto.size === 0) return [...violations]
  const known = new Set(layout.parts.map((part) => part.component))
  return violations.filter((v) => {
    const parts = new Set(v.items.map(partOf).filter((name) => known.has(name)))
    const namesAuto = [...parts].some((name) => auto.has(name))
    if (!namesAuto) return true
    if (AGAINST_BOARD.has(v.code)) return false
    return !BETWEEN_PARTS.has(v.code) || parts.size < 2
  })
}
