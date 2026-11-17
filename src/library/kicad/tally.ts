// What an import of a KiCad board did not bring over, by kind and count, so the answer can say it: nothing is dropped
// silently. The kinds are the words the answer uses.

export const LEFT_KINDS = {
  drawings: "silkscreen and fabrication drawings",
  texts: "texts",
  dimensions: "dimensions",
  models: "3D models",
  rules: "net classes and design rules",
  keepouts: "keepout zones with rules copperflow has no like for (kept clear on every layer instead)",
  teardrops: "teardrops",
  approximated: "pads with a shape copperflow does not draw, drawn as the nearest shape it has",
  innerTracks: "tracks on inner layers",
  innerVias: "vias that do not join the top and the bottom",
  farPads: "pads on the far side of their part (left out)",
  emptyZones: "copper zones on no net",
  unnamedPours: "pours on a connection without a name (left out)",
  otherZones: "zones on no copper layer",
  edgeLeft: "Edge.Cuts shapes not used for the board",
  padless: "footprints without copper pads (logos and drawings)",
  locked: "locks (copperflow's locks are set by a person in copperflow)",
} as const

export type LeftKind = keyof typeof LEFT_KINDS

export class Tally {
  readonly counts = new Map<LeftKind, number>()
  readonly details = new Map<LeftKind, string[]>()
  readonly unknown = new Map<string, number>()

  add(kind: LeftKind, n = 1, detail?: string): void {
    if (n <= 0) return
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + n)
    if (detail !== undefined) this.details.set(kind, [...(this.details.get(kind) ?? []), detail])
  }

  /** A token the reader does not know, counted by name. */
  skip(token: string): void {
    this.unknown.set(token, (this.unknown.get(token) ?? 0) + 1)
  }

  /** "12 silkscreen and fabrication drawings", …, then "not understood: 2 (foo), 1 (bar)"; one line each. */
  lines(): string[] {
    const known = (Object.keys(LEFT_KINDS) as LeftKind[]).flatMap((kind) => {
      const n = this.counts.get(kind)
      if (n === undefined) return []
      const details = this.details.get(kind)
      return [`${n} ${LEFT_KINDS[kind]}${details ? `: ${listed(details)}` : ""}`]
    })
    const unknown = [...this.unknown].sort(([a], [b]) => (a < b ? -1 : 1)).map(([token, n]) => `(${token}) ${n} time${n === 1 ? "" : "s"}`)
    return [...known, ...(unknown.length > 0 ? [`not understood, skipped: ${unknown.join(", ")}`] : [])]
  }
}

/** Up to 20 items, then how many more. */
export function listed(items: readonly string[]): string {
  const shown = items.slice(0, 20).join(", ")
  return items.length > 20 ? `${shown} … and ${items.length - 20} more` : shown
}
