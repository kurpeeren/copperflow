// Edit → Find similar objects (Ctrl+Shift+F), as plain data: the parts like the selected one, by kind, footprint and
// value together, as EasyEDA's dialog finds them with those three ticked; for a selected drawing, the drawings of its
// kind. Pure.

export interface SimilarPart {
  id: string
  kind: string
  footprint?: string
  value?: string
}

export type SimilarResult = { parts: string[]; drawings: string[]; board?: string[]; note: string } | { message: string }

const same = (a: SimilarPart, b: SimilarPart): boolean => a.kind === b.kind && a.footprint === b.footprint && a.value === b.value

/** What is like the first selected part (or, with no part selected, the first selected drawing). */
export function findSimilar(selected: { parts: readonly string[]; drawings: readonly string[]; board?: readonly string[] }, parts: readonly SimilarPart[], drawings: readonly { id: string; kind: string }[], board?: readonly string[]): SimilarResult {
  const first = parts.find((part) => part.id === selected.parts[0])
  if (first) {
    const found = parts.filter((part) => same(part, first)).map((part) => part.id)
    const what = [first.kind, first.value, first.footprint].filter((word) => word !== undefined && word !== "").join(", ")
    return { parts: found, drawings: [], note: `Selected ${found.length} ${found.length === 1 ? "part" : "parts"} like ${first.id} (${what})` }
  }
  const drawing = drawings.find((candidate) => candidate.id === selected.drawings[0])
  if (drawing) {
    const found = drawings.filter((candidate) => candidate.kind === drawing.kind).map((candidate) => candidate.id)
    return { parts: [], drawings: found, note: `Selected ${found.length} ${drawing.kind} ${found.length === 1 ? "drawing" : "drawings"}` }
  }
  const item = selected.board?.[0]
  if (item !== undefined) {
    // A board item's id is its kind and number ("copperpour:2", "hole:1").
    const kind = item.split(":")[0] ?? item
    const found = (board ?? []).filter((id) => id.split(":")[0] === kind)
    return { parts: [], drawings: [], board: found, note: `Selected ${found.length} ${kind === "copperpour" ? "copper pour" : kind}${found.length === 1 ? "" : "s"}` }
  }
  return { message: "Select a part, a drawing, a pour or a hole first; Find similar objects selects the ones like it." }
}
