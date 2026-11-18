import { fillPours, type PourFill, type PourInputs } from "./fill.js"

/** How many boards' fills are kept: the Studio rebuilds one board over and over, the agent may switch between a few. */
const CAPACITY = 8

interface Entry {
  key: string
  fills: PourFill[]
}

const entries = new Map<number, Entry>()

/** A 53-bit string hash (cyrb53): quick to compute, and a hit is still checked against the whole key. */
function hash(text: string): number {
  let [h1, h2] = [0xdeadbeef, 0x41c6ce57]
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/**
 * Everything the fill depends on, and nothing else: no source positions, so editing another line of the file does
 * not refill the pours.
 */
export function pourInputKey(inputs: PourInputs): string {
  const { board, pads, tracks, vias, rules } = inputs
  const nets = [...new Set([...pads.map((p) => p.net), ...tracks.map((t) => t.net), ...vias.map((v) => v.net), ...(board.pours ?? []).map((p) => p.net)])]
  return JSON.stringify({
    outline: board.outline,
    keepouts: board.keepouts.map((k) => [k.outline, k.layers]),
    holes: (board.holes ?? []).map((h) => [h.x, h.y, h.diameter]),
    drawings: (board.graphics ?? []).filter((g) => ["top", "bottom", "inner1", "inner2"].includes(g.layer)).map((g) => [g.layer, g.areas, g.lines]),
    pours: (board.pours ?? []).map(({ source: _source, ...pour }) => pour),
    pads: pads.map((p) => [p.shape, p.x, p.y, p.width, p.height, p.rotation, p.layers, p.cornerRadius ?? null, p.net ?? null]),
    tracks: tracks.map((t) => [t.layer, t.width, t.points, t.net ?? null, t.missingLayer ?? null]),
    vias: vias.map((v) => [v.at, v.diameter, v.layers, v.net ?? null, v.missingLayer ?? null]),
    rules: [rules.fabrication.boardEdgeClearance, rules.fabrication.minClearance, rules.classes.map((c) => [c.name, c.clearance]), rules.classClearance],
    classes: [undefined, ...nets].map((net) => [net ?? null, inputs.classOf(net)]),
  })
}

/** The fills of the board's pours, computed once for each distinct input and then served from the cache. */
export function cachedPourFills(inputs: PourInputs): PourFill[] {
  if ((inputs.board.pours ?? []).length === 0) return []
  const key = pourInputKey(inputs)
  const code = hash(key)
  const known = entries.get(code)
  if (known && known.key === key) {
    entries.delete(code)
    entries.set(code, known)
    return known.fills
  }
  const fills = fillPours(inputs)
  entries.delete(code)
  entries.set(code, { key, fills })
  while (entries.size > CAPACITY) entries.delete(entries.keys().next().value as number)
  return fills
}
