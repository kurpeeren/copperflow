// The board's copper pours and holes as the file writes them (`<copperpour>`, `<hole>`), with the ids the engine gives
// them: "copperpour:<n>" and "hole:<n>", counted in source order among the ones the engine keeps (pour/build.ts,
// hole.ts). The scan counts every tag; one whose id the file alone cannot tell (an earlier one the engine may drop or
// make any number of times) is read-only, so an edit never reaches a pour or hole the Studio did not mean.
import type { JSXElement } from "@babel/types"
import { readPointList } from "./literals.js"
import type { BoardItemInfo, BoardItemTag, Point, PropInfo } from "./types.js"

export const BOARD_ITEM_TAGS: readonly BoardItemTag[] = ["copperpour", "hole"]

/** The copper layers a pour can name. */
export const POUR_LAYERS = ["top", "bottom", "inner1", "inner2"] as const

export const UNSURE_BOARD_ID = "its id depends on an earlier one the engine may skip or make any number of times; edit it in the code"
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

const literalOf = (props: Record<string, PropInfo>, key: string) => props[key]?.literal
const isLength = (value: unknown): boolean => typeof value === "number" || (typeof value === "string" && value.trim() !== "")

/** Whether the engine surely keeps a pour (and so counts it): a literal net and layer, and a literal outline of 3 or more points when it has one. */
function pourKept(facts: BoardItemTagFacts, outline: Point[] | undefined): boolean {
  const net = literalOf(facts.props, "net")
  const layer = literalOf(facts.props, "layer")
  const outlineOk = facts.props["outline"] === undefined || (outline !== undefined && outline.length >= 3)
  return typeof net === "string" && net !== "" && (POUR_LAYERS as readonly unknown[]).includes(layer) && outlineOk
}

/** Whether the engine surely keeps a hole: literal x, y and a positive diameter. */
function holeKept(facts: BoardItemTagFacts): boolean {
  const [x, y, diameter] = ["x", "y", "diameter"].map((key) => literalOf(facts.props, key))
  return isLength(x) && isLength(y) && (typeof diameter === "string" ? isLength(diameter) : typeof diameter === "number" && diameter > 0)
}

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
    const kept = facts.tag === "copperpour" ? pourKept(facts, outline) : holeKept(facts)
    if (facts.uncounted || !kept) unsure.add(facts.tag)
    items.push(info(facts, id, outline, reason))
    nodes.set(id, facts.node)
  }
  return { items, nodes }
}
