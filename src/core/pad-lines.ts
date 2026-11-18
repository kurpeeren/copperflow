// A footprint's pads as answer lines: number, centre, size, hole and what the pad is. Pure.
import type { Pad } from "../engine/footprints/types.js"

/** The most pads listed for one footprint; the rest are counted. */
export const PADS_SHOWN = 64

const mm = (v: number) => String(Math.round(v * 1000) / 1000)

/** "  1  at (-6.95, 0)  4.2 x 1.7 rect  hole 3.2 x 0.7  centre pin" */
export function padLine(pad: Pad, role: string | undefined): string {
  const size = `${mm(pad.width)} x ${mm(pad.height)} ${pad.shape}${pad.rotation !== 0 ? ` rotated ${mm(pad.rotation)}` : ""}`
  const hole = pad.drill ? `  hole ${pad.drill.width === pad.drill.height ? mm(pad.drill.width) : `${mm(pad.drill.width)} x ${mm(pad.drill.height)}`}` : ""
  return `  ${pad.number}  at (${mm(pad.x)}, ${mm(pad.y)})  ${size}${hole}${role ? `  ${role}` : ""}`
}

/** One line per pad, at most PADS_SHOWN, with the role or name `label` gives a pad number. */
export function padLines(pads: readonly Pad[], label: (number: string) => string | undefined = () => undefined): string[] {
  const shown = pads.slice(0, PADS_SHOWN).map((pad) => padLine(pad, label(pad.number)))
  return pads.length > PADS_SHOWN ? [...shown, `  … and ${pads.length - PADS_SHOWN} more pads`] : shown
}
