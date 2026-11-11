// Exposed (thermal) pads of no-lead packages and the names of packages given by body and pitch.
import { padsApart, tidy, type Extent } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import { refuse, type Pad, type Refusal } from "./types.js"

/**
 * The least gap between two pads of a generated footprint, exposed pad included. A choice made here,
 * not an IPC-7351B value: the corner pads of the cited QFNs are 0.125 mm apart, so the bound sits
 * just below that and refuses only strings whose pads would merge.
 */
export const MIN_PAD_GAP = 0.1

/** A length as a footprint name writes it: "0.5", "3.1", "10". */
export const mm = (value: number): string => String(tidy(value))

/** "3.1" for a square, "1.6x2.4" for a rectangle. */
export const sizeText = (size: Extent): string => (size.x === size.y ? mm(size.x) : `${mm(size.x)}x${mm(size.y)}`)

/** True when the only parameter is the pitch `_p` and there are no pairs. */
export function onlyPitch(parsed: ParsedFootprint): boolean {
  return Object.keys(parsed.params).every((key) => key === "p") && parsed.pairs === undefined
}

/**
 * The exposed pad a no-lead package string asks for: `_ep3.1` (square) or `_ep1.6x2.4` (width along
 * x by height along y), undefined without one, and a refusal when the string has anything else
 * besides `_p` or when `_ep` has no size (a package named by its body has no drawing to take the
 * size from).
 */
export function exposedPadSize(parsed: ParsedFootprint, label: string): Extent | undefined | Refusal {
  const others = [...Object.keys(parsed.params), ...Object.keys(parsed.pairs ?? {})].filter((key) => key !== "p" && key !== "ep")
  if (others.length > 0) return refuse(`a ${label} takes only _p and _ep, not _${others[0]}`)
  const side = parsed.params["ep"]
  const sides = parsed.pairs?.["ep"]
  if (side === true) return refuse("_ep needs the exposed pad's size, such as _ep3.1 or _ep1.6x2.4")
  if (typeof side === "number") return side > 0 ? { x: side, y: side } : refuse("the exposed pad needs a size above 0")
  if (sides) return sides[0] > 0 && sides[1] > 0 ? { x: sides[0], y: sides[1] } : refuse("the exposed pad needs a size above 0")
  return undefined
}

/**
 * Why a set of pads fails the gap: the exposed pad (the last pad when `thermal`) against the pins,
 * or the pins against each other; undefined when they keep it.
 */
export function crowded(pads: readonly Pad[], thermal: boolean): Refusal | undefined {
  if (padsApart(pads, MIN_PAD_GAP)) return undefined
  const signal = thermal ? pads.slice(0, -1) : pads
  if (!padsApart(signal, MIN_PAD_GAP)) return refuse(`the pins would come closer than ${MIN_PAD_GAP} mm to each other`)
  return refuse("the exposed pad would touch the pins")
}
