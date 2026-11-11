// Edit → Find similar objects (Ctrl+Shift+F), as plain data: the parts like the selected one, by kind, footprint and
// value together, as EasyEDA's dialog finds them with those three ticked; for a selected drawing, the drawings of its
// kind. Pure.

export interface SimilarPart {
  id: string
  kind: string
  footprint?: string
  value?: string
}

export type SimilarResult = { parts: string[]; drawings: string[]; note: string } | { message: string }

const same = (a: SimilarPart, b: SimilarPart): boolean => a.kind === b.kind && a.footprint === b.footprint && a.value === b.value

/** What is like the first selected part (or, with no part selected, the first selected drawing). */
export function findSimilar(selected: { parts: readonly string[]; drawings: readonly string[] }, parts: readonly SimilarPart[], drawings: readonly { id: string; kind: string }[]): SimilarResult {
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
  return { message: "Select a part or a drawing first; Find similar objects selects the ones like it." }
}
