import type { JSXAttribute, JSXElement } from "@babel/types"
import { drawingIds, drawingName, type DrawingId } from "../engine/drawing-ids.js"
import { kindOf } from "../engine/kinds.js"
import type { DrawingKind } from "../engine/model.js"
import { readPointList } from "./literals.js"
import type { DrawingInfo, PropInfo, SkippedElement } from "./types.js"

export const NAME_NOT_LITERAL = "name is not a string literal"
export const UNSURE_ID = "its id depends on an earlier drawing made in a callback or with a computed name"

/** A drawing tag as the scan meets it, in source order. */
export interface DrawingTag {
  kind: DrawingKind
  tag: string
  node: JSXElement
  attributes: JSXAttribute[]
  props: Record<string, PropInfo>
  line: number
  start: number
  end: number
  readonlyReason?: string
  /** Made in a callback such as .map(), so the engine may see it any number of times. */
  inCallback: boolean
  hasSpread: boolean
}

/** A named element the scan found, as the drawing ids need it. */
export interface NamedElement {
  name: string
  tag: string
  inCallback: boolean
}

export interface ScannedDrawings {
  drawings: DrawingInfo[]
  nodes: Map<string, JSXElement>
  skipped: SkippedElement[]
}

/**
 * Elements the engine makes parts of, whose names a drawing cannot take: built-in kinds and components. As in
 * JSX, a tag is a component when it is a member expression (`<lib.Chip>`) or does not start with a lowercase letter.
 */
function isEnginePart(tag: string): boolean {
  return kindOf(tag) !== undefined || tag.includes(".") || !/^[a-z]/.test(tag)
}

/**
 * Remembers what the drawings and parts read so far leave unknown about later ids: a tag made in a callback
 * may be drawn any number of times, which shifts the later unnamed ids of its kind and repeats its name, and a
 * computed name (or spread props) may take any name.
 */
function doubts(callbackParts: Iterable<string>) {
  const kinds = new Set<DrawingKind>()
  const names = new Set(callbackParts)
  let anyName = false
  return {
    unsure: (kind: DrawingKind, name: string | undefined) => (name === undefined ? kinds.has(kind) : anyName || names.has(name)),
    note(tag: DrawingTag, name: string | undefined, nameUnknown: boolean) {
      if (tag.inCallback) kinds.add(tag.kind)
      if (tag.inCallback && name !== undefined) names.add(name)
      if (nameUnknown) anyName = true
    },
  }
}

function drawingInfo(tag: DrawingTag, id: string, name: string | undefined, readonlyReason: string | undefined): DrawingInfo {
  const attribute = tag.attributes.find((a) => a.name.type === "JSXIdentifier" && a.name.name === "points")
  const points = readPointList(attribute?.value)
  const props = Object.fromEntries(Object.entries(tag.props).filter(([key]) => key !== "name"))
  if (points && props["points"]) props["points"] = { ...props["points"], editable: true }
  return {
    id,
    tag: tag.tag,
    ...(name === undefined ? {} : { name }),
    ...(points ? { points } : {}),
    props,
    line: tag.line,
    editable: readonlyReason === undefined,
    ...(readonlyReason ? { readonlyReason } : {}),
    start: tag.start,
    end: tag.end,
  }
}

/**
 * The file's drawings with the ids the engine gives them (the shared rule in drawing-ids.ts). A drawing whose
 * name is an expression is skipped; one whose id the file alone cannot tell is read-only, so an edit never
 * reaches a drawing the Studio did not mean. Drawings made inside other components are not seen.
 */
export function scanDrawings(tags: readonly DrawingTag[], named: readonly NamedElement[]): ScannedDrawings {
  const parts = named.filter((element) => isEnginePart(element.tag))
  const names = tags.map((tag) => drawingName(tag.kind, tag.props["name"]?.literal))
  const ids = drawingIds(
    tags.map((tag, index) => ({ kind: tag.kind, name: names[index] })),
    parts.map((part) => part.name),
  )
  const doubt = doubts(parts.filter((part) => part.inCallback).map((part) => part.name))
  const result: ScannedDrawings = { drawings: [], nodes: new Map(), skipped: [] }
  tags.forEach((tag, index) => {
    const name = names[index]
    const computed = tag.props["name"] !== undefined && tag.props["name"].literal === undefined
    const unsure = doubt.unsure(tag.kind, name)
    doubt.note(tag, name, computed || tag.hasSpread)
    if (computed) {
      result.skipped.push({ tag: tag.tag, line: tag.line, reason: NAME_NOT_LITERAL })
      return
    }
    const { id } = ids[index] as DrawingId
    result.drawings.push(drawingInfo(tag, id, name, tag.readonlyReason ?? (unsure ? UNSURE_ID : undefined)))
    result.nodes.set(id, tag.node)
  })
  return result
}
