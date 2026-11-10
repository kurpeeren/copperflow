// The board's copper pours and holes as the file writes them (`<copperpour>`, `<hole>`), with the ids the engine gives
// them: "copperpour:<n>" and "hole:<n>", every tag of each counted in source order, kept by the engine or not
// (elaborate.ts). Only a tag the engine may make any number of times (in a callback, a condition or a helper) leaves
// the later ids of its tag unknown; those are read-only, so an edit never reaches a pour or hole the Studio did not mean.
import type { JSXElement } from "@babel/types"
import { readPointList } from "./literals.js"
import type { BoardItemInfo, BoardItemTag, Point, PropInfo } from "./types.js"

export const BOARD_ITEM_TAGS: readonly BoardItemTag[] = ["copperpour", "hole"]

/** The copper layers a pour can name. */
export const POUR_LAYERS = ["top", "bottom", "inner1", "inner2"] as const

export const UNSURE_BOARD_ID = "its id depends on an earlier one the engine may make any number of times; edit it in the code"
export const NOT_AT_TOP = "it is inside a <group>, whose offset moves it; edit it in the code"

/** A board item's tag as the scan meets it, in source order. */
export interface BoardItemTagFacts {
  tag: BoardItemTag
  node: JSXElement
  props: Record<string, PropInfo>
  outlineValue: Parameters<typeof readPointList>[0]
  line: number
  start: number
  end: number
  readonlyReason?: string
  parent?: string
  uncounted?: string
}

export const isBoardItemTag = (tag: string): tag is BoardItemTag => (BOARD_ITEM_TAGS as readonly string[]).includes(tag)

function info(facts: BoardItemTagFacts, id: string, outline: Point[] | undefined, reason: string | undefined): BoardItemInfo {
  const props = { ...facts.props }
  if (outline && props["outline"]) props["outline"] = { ...props["outline"], editable: true }
  return {
    id,
    tag: facts.tag,
    props,
    ...(outline ? { outline } : {}),
    ...(facts.parent === undefined ? {} : { parent: facts.parent }),
    line: facts.line,
    editable: reason === undefined,
    ...(reason ? { readonlyReason: reason } : {}),
    start: facts.start,
    end: facts.end,
  }
}

const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y

/** Which side of the line a→b the point c lies on: positive left, negative right, zero on it. */
const side = (a: Point, b: Point, c: Point): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

/** Whether the segments a–b and c–d cross or touch (collinear overlaps included). */
function segmentsMeet(a: Point, b: Point, c: Point, d: Point): boolean {
  const [d1, d2, d3, d4] = [side(c, d, a), side(c, d, b), side(a, b, c), side(a, b, d)]
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  const within = (p: Point, q: Point, r: Point) => Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y)
  return (d1 === 0 && within(c, d, a)) || (d2 === 0 && within(c, d, b)) || (d3 === 0 && within(a, b, c)) || (d4 === 0 && within(a, b, d))
}

/**
 * What is wrong with a pour's outline as a polygon, or undefined when it is a simple one: two corners in a row at one
 * place (the last and the first count as a row), no area (every corner on one line), or two edges that cross.
 */
export function outlineProblem(points: readonly Point[]): string | undefined {
  const n = points.length
  if (n < 3) return "an outline needs at least 3 corners"
  if (points.some((p, i) => same(p, points[(i + 1) % n] as Point))) return "two corners in a row are at the same place"
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Edges that share a corner always meet there; only the others may not meet at all.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      const [a, b, c, d] = [points[i], points[(i + 1) % n], points[j], points[(j + 1) % n]] as Point[]
      if (segmentsMeet(a as Point, b as Point, c as Point, d as Point)) return "two of its edges cross"
    }
  }
  const area = points.reduce((sum, a, i) => sum + side({ x: 0, y: 0 }, a, points[(i + 1) % n] as Point), 0)
  return Math.abs(area) < 1e-9 ? "its corners are all on one line, so it has no area" : undefined
}

/** The id a new pour or hole gets: every tag of its kind is counted, and addPour and addHole put a new one after them all. */
export function newBoardItemId(items: readonly Pick<BoardItemInfo, "tag">[], tag: BoardItemTag): string {
  return `${tag}:${items.filter((item) => item.tag === tag).length + 1}`
}

/** The file's pours and holes with their ids, and the AST node of each by id. */
export function scanBoardItems(tags: readonly BoardItemTagFacts[]): { items: BoardItemInfo[]; nodes: Map<string, JSXElement> } {
  const counts = new Map<BoardItemTag, number>()
  const unsure = new Set<BoardItemTag>()
  const items: BoardItemInfo[] = []
  const nodes = new Map<string, JSXElement>()
  for (const facts of tags) {
    const outline = facts.tag === "copperpour" ? readPointList(facts.outlineValue) : undefined
    const index = (counts.get(facts.tag) ?? 0) + 1
    counts.set(facts.tag, index)
    const id = `${facts.tag}:${index}`
    const atTop = facts.parent === "board" || facts.parent === "sheet"
    const reason = facts.readonlyReason ?? facts.uncounted ?? (unsure.has(facts.tag) ? UNSURE_BOARD_ID : atTop ? undefined : NOT_AT_TOP)
    if (facts.uncounted) unsure.add(facts.tag)
    items.push(info(facts, id, outline, reason))
    nodes.set(id, facts.node)
  }
  return { items, nodes }
}
