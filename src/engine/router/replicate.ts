import type { Component, Point, SheetInstance } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PlacedFootprint, WorldPad } from "../pcb.js"
import { offenders, type Laid } from "./clear.js"
import { copperObstacles, type Congestion } from "./congestion.js"
import { netRule, why } from "./connect.js"
import type { RouterWorld } from "./grid.js"
import type { Obstacle } from "./obstacles.js"
import type { RoutedCopper } from "./path.js"
import type { RouteBoardInput, RoutedConnection, UnroutedConnection } from "./route-board.js"

/**
 * Copying an instance's routes to the other instances of its sheet, as Replicate layout does: where a target's parts
 * sit in its own frame exactly as the source's sit in theirs, each route of the source is turned into the target's
 * frame, onto the same pads of the target's parts and the nets those pads are on. A copy is kept only when the exact
 * clearance check passes against everything already on the board and laid in the run; otherwise it is reported.
 */

export interface Replica {
  instance: string
  /** The routes copied. */
  copied: number
  /** Why nothing was copied: the placement does not match the source's. */
  reason?: string
}

interface Frame {
  x: number
  y: number
  rotation: number
}

/** Positions closer than this, in mm, are the same. */
const SAME = 1e-6
const DEG = Math.PI / 180
const toNanometre = (mm: number): number => Math.round(mm * 1e6) / 1e6 || 0
const frameOf = (instance: SheetInstance): Frame => instance.pcb ?? { x: 0, y: 0, rotation: 0 }

function turned(p: Point, degrees: number): Point {
  const quarter = degrees / 90
  if (Number.isInteger(quarter)) {
    const [cos, sin] = [[1, 0], [0, 1], [-1, 0], [0, -1]][((quarter % 4) + 4) % 4] as [number, number]
    return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }
  }
  const [cos, sin] = [Math.cos(degrees * DEG), Math.sin(degrees * DEG)]
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }
}

const toLocal = (p: Point, frame: Frame): Point => turned({ x: p.x - frame.x, y: p.y - frame.y }, -frame.rotation)
const toBoard = (p: Point, frame: Frame): Point => {
  const q = turned(p, frame.rotation)
  return { x: toNanometre(q.x + frame.x), y: toNanometre(q.y + frame.y) }
}
const angle = (degrees: number) => ((degrees % 360) + 360) % 360

/** A part's key inside its instance: its nested instance path below the instance, and its name in the sheet. */
const keyIn = (component: Component, instance: SheetInstance) => `${(component.instance ?? "").slice(instance.path.length)}|${component.localId ?? component.id}`

/** The target's part for each source part, when every part is there and sits the same in its instance's frame. */
function partMap(input: RouteBoardInput, source: SheetInstance, target: SheetInstance): Map<string, string> | undefined {
  const components = input.components ?? []
  const placed = new Map(input.layout.parts.map((part) => [part.component, part]))
  const inside = (instance: SheetInstance) => new Map(components.filter((c) => instance.parts.includes(c.id)).map((c) => [keyIn(c, instance), c.id]))
  const [mine, theirs] = [inside(source), inside(target)]
  if (mine.size !== theirs.size) return undefined
  const map = new Map<string, string>()
  const same = (a: PlacedFootprint, b: PlacedFootprint) => {
    const [p, q] = [toLocal(a, frameOf(source)), toLocal(b, frameOf(target))]
    const turn = angle(a.rotation - frameOf(source).rotation) - angle(b.rotation - frameOf(target).rotation)
    return Math.abs(p.x - q.x) < SAME && Math.abs(p.y - q.y) < SAME && Math.abs(turn) < SAME && a.side === b.side
  }
  for (const [key, id] of mine) {
    const other = theirs.get(key)
    const [a, b] = [placed.get(id), other === undefined ? undefined : placed.get(other)]
    if (other === undefined || a === undefined || b === undefined || !same(a, b)) return undefined
    map.set(id, other)
  }
  return map
}

/** The route turned into the target's frame, on the target's net. */
function moved(copper: RoutedCopper, net: string, from: Frame, to: Frame): RoutedCopper {
  const move = (p: Point) => toBoard(toLocal(p, from), to)
  return {
    net,
    tracks: copper.tracks.map((track) => ({ ...track, points: track.points.map(move) })),
    vias: copper.vias.map((via) => ({ ...via, at: move(via.at), layers: [...via.layers] })),
  }
}

/** What the copy would come too near to, laid piece by piece. */
function copyOffenders(world: RouterWorld, input: RouteBoardInput, copper: RoutedCopper, walls: readonly Obstacle[]): string[] {
  const rule = netRule(input.rules, input.nets, copper.net)
  const pieces = copperObstacles(copper, rule.className)
  const found = new Set<string>()
  for (const piece of pieces) {
    const laid: Laid = { kind: piece.kind === "via" ? "via" : "track", layers: piece.kind === "via" ? world.frame.layers : piece.layers, shapes: piece.shapes, ...(piece.hole ? { hole: piece.hole } : {}) }
    for (const name of offenders(world, rule, laid, walls)) found.add(name)
  }
  return [...found].sort(naturalCompare)
}

export interface Copies {
  routed: RoutedConnection[]
  unrouted: UnroutedConnection[]
  replicas: Replica[]
}

/** Copies the source instance's routes to the other instances of its sheet (see the module comment). */
export function replicate(world: RouterWorld, input: RouteBoardInput, name: string, routed: readonly RoutedConnection[], congestion: Congestion): Copies {
  const source = input.instances?.find((instance) => instance.name === name || instance.path === name)
  if (source === undefined) return { routed: [], unrouted: [], replicas: [] }
  const targets = (input.instances ?? []).filter((instance) => instance.file === source.file && instance.path !== source.path)
  const pads = new Map(input.layout.parts.flatMap((part) => part.pads).map((pad) => [pad.id, pad]))
  const missing = new Set(input.layout.ratsnest.map((line) => [line.from, line.to].sort(naturalCompare).join(" ")))
  const walls: Obstacle[] = [...congestion.placed.values()].sort((a, b) => a.index - b.index).flatMap((placed) => placed.pieces)
  const copies: Copies = { routed: [], unrouted: [], replicas: [] }
  for (const target of targets) {
    const parts = partMap(input, source, target)
    if (parts === undefined) {
      copies.replicas.push({ instance: target.name, copied: 0, reason: `its placement differs from ${source.name}` })
      continue
    }
    const padIn = (id: string): WorldPad | undefined => {
      const [component, ...rest] = id.split("#")
      const other = parts.get(component ?? "")
      return other === undefined ? undefined : pads.get([other, ...rest].join("#"))
    }
    let copied = 0
    for (const route of routed) {
      const [from, to] = [padIn(route.from), padIn(route.to)]
      if (from === undefined || to === undefined || from.net === undefined || from.net !== to.net) continue
      if (!missing.has([from.id, to.id].sort(naturalCompare).join(" "))) continue
      const copper = moved(route.copper, from.net, frameOf(source), frameOf(target))
      const blockers = copyOffenders(world, input, copper, walls)
      if (blockers.length > 0) {
        copies.unrouted.push({ net: from.net, from: from.id, to: to.id, reason: why(from, to, blockers, "no-path", 0), blockers })
        continue
      }
      walls.push(...copperObstacles(copper, netRule(input.rules, input.nets, from.net).className))
      copies.routed.push({ net: from.net, from: from.id, to: to.id, copper, copiedFrom: source.name })
      copied++
    }
    copies.replicas.push({ instance: target.name, copied })
  }
  return copies
}
