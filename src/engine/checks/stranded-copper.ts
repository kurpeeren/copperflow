// Copper a change of the parts or the board left behind: a track that touched a pad before and no longer does (its
// part moved; copper does not follow a part, as in the Studio, where only copper selected with the part moves), and
// copper the board's edge check finds that it did not find before (the board was fitted round the parts and the copper
// now lies outside it). Pure: it compares two builds of the same circuit.
import type { Design } from "../design.js"
import type { Violation } from "./violation.js"

/** One piece of copper left behind, and what became of it. */
export interface StrandedCopper {
  id: string
  net?: string
  why: string
}

const padText = (padId: string) => padId.replace("#", " pad ")

/** Tracks that touched a pad in `before` and no longer touch it in `after`. */
function offPads(before: Pick<Design, "pcb">, after: Pick<Design, "pcb">): StrandedCopper[] {
  const was = new Map(before.pcb.tracks.map((track) => [track.id, track.pads]))
  return after.pcb.tracks.flatMap((track) => {
    const lost = (was.get(track.id) ?? []).filter((pad) => !track.pads.includes(pad))
    if (lost.length === 0) return []
    return [{ id: track.id, ...(track.net === undefined ? {} : { net: track.net }), why: `no longer ends on ${lost.map(padText).join(" or ")}` }]
  })
}

/** The copper-edge findings of `after` on tracks and vias that `before` did not have. */
function offBoard(before: Pick<Design, "violations">, after: Pick<Design, "pcb" | "violations">): StrandedCopper[] {
  const known = new Set(before.violations.filter((v) => v.code === "copper-edge").map((v) => v.id))
  const nets = new Map([...after.pcb.tracks, ...after.pcb.vias].map((one) => [one.id, one.net]))
  return after.violations
    .filter((v: Violation) => v.code === "copper-edge" && !known.has(v.id))
    .flatMap((v) => v.items.filter((id) => nets.has(id)).map((id) => ({ id, ...(nets.get(id) === undefined ? {} : { net: nets.get(id) as string }), why: v.message.startsWith(`${id} `) ? v.message.slice(id.length + 1) : v.message })))
}

/** The copper left behind between two builds (see the module comment), one entry per id, in the order found. */
export function strandedCopper(before: Pick<Design, "pcb" | "violations">, after: Pick<Design, "pcb" | "violations">): StrandedCopper[] {
  const found = [...offPads(before, after), ...offBoard(before, after)]
  const byId = new Map<string, StrandedCopper>()
  for (const one of found) {
    const seen = byId.get(one.id)
    byId.set(one.id, seen ? { ...seen, why: `${seen.why}; ${one.why}` } : one)
  }
  return [...byId.values()]
}

/**
 * The lines of an answer naming the copper left behind and what to do: remove_copper with the ids, or with the nets
 * (the router's copper of them), and route again. None when nothing was left behind.
 */
export function strandedLines(stranded: readonly StrandedCopper[], netName: (net: string) => string = (net) => net): string[] {
  if (stranded.length === 0) return []
  const ids = stranded.map((one) => one.id)
  const nets = [...new Set(stranded.flatMap((one) => (one.net === undefined ? [] : [netName(one.net)])))]
  const named = stranded.map((one) => `${one.id} ${one.why}`).join("; ")
  const unroute = nets.length === 0 ? "" : ` or { nets: ${JSON.stringify(nets)} }`
  return [`Copper left behind: ${named}. Remove it with remove_copper { ids: ${JSON.stringify(ids)} }${unroute}, then autoroute.`]
}
