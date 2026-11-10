// Design rules write rules.yaml, which the next build reads. Until a build that started after the write is shown, the design
// on screen still has the old fillet radius, so Fillet tracks asks here for the radius the person saved last (the server's
// write mark of it orders it against builds, as an edit's does). Plain TypeScript, so the tests can run it.
import type { Design } from "../api.js"

/** A fillet radius saved in Design rules (null for the default), and the server's mark of the write (LiveProject.nextMark). */
export interface RulesWrite {
  radius: number | null
  mark: number
}

let latest: RulesWrite | undefined

/** Remembers the newest saved radius. */
export function noteRulesWrite(write: RulesWrite): void {
  latest = write
}

/** The newest saved radius, if any was saved in this session. */
export function latestRulesWrite(): RulesWrite | undefined {
  return latest
}

/** Forgets what was saved (tests). */
export function forgetRulesWrite(): void {
  latest = undefined
}

/**
 * The design with the saved fillet radius in its rules when the shown build has not read the write yet (it started before
 * the write's mark, or is unknown); the same design once a build that started after the write is shown.
 */
export function designWithSavedRadius(design: Design, write: RulesWrite | undefined, builtMark: number | undefined): Design {
  if (!write || (builtMark !== undefined && builtMark > write.mark)) return design
  const { filletRadius: _old, ...fabrication } = design.rules.fabrication
  return { ...design, rules: { ...design.rules, fabrication: write.radius === null ? fabrication : { ...fabrication, filletRadius: write.radius } } }
}
