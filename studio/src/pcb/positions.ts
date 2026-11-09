// Where parts sit in each view and the position props that put them there.
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import type { CircuitModel } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import { roundPosition, type Point } from "./geometry.js"

/** The circuit's source model, as GET /api/circuit sends it. */
export interface SourceCircuit {
  model: CircuitModel
}

export type View = "pcb" | "schematic"

/** The props and wording that differ between the PCB and the schematic. */
export const VIEWS = {
  pcb: { position: ["pcbX", "pcbY"], rotation: "pcbRotation", where: "", notePrompt: "Note for the agent, e.g. route ground here" },
  schematic: {
    position: ["schX", "schY"],
    rotation: "schRotation",
    where: " in the schematic",
    notePrompt: "Note for the agent, e.g. add a pull-up here",
  },
} as const

/** Where a part sits in one view, and what its groups add to the position props that put it there. */
export interface Anchor {
  origin: Point
  group: Point
  autoPlaced: boolean
}

export const ZERO: Point = { x: 0, y: 0 }

/** Every placed part of `view` by component id. A position prop is `origin - group`. */
export function partAnchors(design: Design, view: View): Map<string, Anchor> {
  const groups = new Map(design.circuit.components.map((c) => [c.id, view === "pcb" ? c.groupOffset.pcb : c.groupOffset.sch]))
  const placed = view === "pcb" ? design.pcb.parts : design.schematic.symbols
  return new Map(placed.map((p) => [p.component, { origin: { x: p.x, y: p.y }, group: groups.get(p.component) ?? ZERO, autoPlaced: p.autoPlaced }]))
}

/** Why a part cannot be moved or changed in `view`, or null when it can. */
export function moveBlocker(circuit: SourceCircuit, locked: ReadonlySet<string>, name: string, view: View): string | null {
  const part = circuit.model.parts.find((p) => p.name === name)
  if (!part) return "This part has no editable source element"
  if (locked.has(name)) return `${name} is locked`
  if (!part.editable) return `${name} is read-only (${part.readonlyReason})`
  const expression = VIEWS[view].position.find((key) => part.props[key] && !part.props[key]?.editable)
  return expression ? `${name}.${expression} is an expression; change it in the code` : null
}

/** A quarter turn: 90 is counter-clockwise (the Rotate key), -90 clockwise (Rotate right). */
export type Turn = 90 | -90

/** The next quarter turn of the part's rotation prop in `view`, or a message when that prop is not a number. */
export function nextRotation(circuit: SourceCircuit, name: string, view: View, turn: Turn = 90): number | string {
  const key = VIEWS[view].rotation
  const rotation = circuit.model.parts.find((p) => p.name === name)?.props[key]?.literal
  if (rotation !== undefined && typeof rotation !== "number") return `${name}.${key} is not a number`
  return ((((rotation ?? 0) as number) + turn) % 360 + 360) % 360
}

/**
 * A part's position props in `view` as the source has them: each literal, or, when the part has none, where it sits
 * less what its groups add. Not rounded.
 */
export function sourcePosition(circuit: SourceCircuit, name: string, view: View, anchor: Pick<Anchor, "origin" | "group">): Point {
  const props = circuit.model.parts.find((p) => p.name === name)?.props
  const [keyX, keyY] = VIEWS[view].position
  const prop = (key: string, origin: number, group: number) => {
    const current = props?.[key]?.literal
    return typeof current === "number" ? current : origin - group
  }
  return { x: prop(keyX, anchor.origin.x, anchor.group.x), y: prop(keyY, anchor.origin.y, anchor.group.y) }
}

/**
 * The position props that move a part by `offset` in `view`: a literal plus the offset, or, when
 * the part has no literal, where it sits plus the offset, less what its groups add.
 */
export function movedTo(circuit: SourceCircuit, name: string, view: View, anchor: Pick<Anchor, "origin" | "group">, offset: Point): [number, number] {
  const at = sourcePosition(circuit, name, view, anchor)
  return [roundPosition(at.x + offset.x), roundPosition(at.y + offset.y)]
}
