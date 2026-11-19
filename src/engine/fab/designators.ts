// Where each part's designator goes on the silkscreen. A designator a person placed with pcbNameAt keeps its place
// (and pcbNameRotation its turn) and is set first. Every other one takes the nearest place round its part
// (designator-places.ts) where its text covers no pad, hole, via, other part's courtyard, silkscreen text or designator
// and stays on the board; the copies of one sheet's part take the same place round their parts when it is clear for all of them. When
// no place is clear it takes the least bad one. A designator that still covers pads, another designator or the board's
// edge gives a warning naming them, since the board house clips silkscreen off the pads. Pure.
import { usableOutline } from "../board.js"
import type { Point } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PcbLayout, PlacedFootprint } from "../pcb.js"
import type { FabricationProfile } from "../rules/schema.js"
import { silkTextBox } from "./silk-text-strokes.js"
import { BETWEEN, boxOf, maskBox, placesAround, SilkObstacles, textBox, type Covered, type DesignatorTurn, type Place } from "./designator-places.js"

export { DESIGNATOR_HEIGHT, SILK_WIDTH, type DesignatorTurn } from "./designator-places.js"

/** The mask opening's growth past each pad when the profile sets none, in mm. */
export const DEFAULT_MASK_EXPANSION = 0.05
/** The gap kept between a designator and its courtyard, and between designators, when none is given, in mm. */
export const DEFAULT_SILK_CLEARANCE = 0.15

export interface DesignatorPlacement {
  component: string
  side: "top" | "bottom"
  /** The middle of the designator's text. */
  at: Point
  /** 0 reads left to right; 90 reads from the bottom up. */
  rotation: DesignatorTurn
  /** The parts whose mask openings the text still covers, in designator order. */
  coversPads: string[]
  /** The other designators the text still covers, in designator order. */
  coversDesignators: string[]
  /** The other parts whose courtyards the text lies on, in designator order. */
  coversParts: string[]
  /** The ids of the board's silkscreen texts the designator lies on. */
  coversTexts: string[]
  /** Whether the text runs off the board. */
  offBoard: boolean
}

/** The board a designator is placed on: its parts, and the outline, vias and holes when there are any. */
export type SilkBoard = Pick<PcbLayout, "parts"> & Partial<Pick<PcbLayout, "board" | "vias" | "holes" | "silkTexts">>

const unique = (names: readonly string[]) => [...new Set(names)].sort(naturalCompare)
const sameTurn = (degrees: number) => ((Math.round(degrees) % 360) + 360) % 360

function obstaclesOf(pcb: SilkBoard, expansion: number, clearance: number): SilkObstacles {
  const outline = usableOutline(pcb.board) ? pcb.board?.outline : undefined
  const obstacles = new SilkObstacles(outline, clearance)
  for (const part of pcb.parts) {
    for (const pad of part.pads) obstacles.add("pad", part.component, pad.layers === "through" ? "both" : pad.layers, maskBox(pad, expansion))
    if (part.courtyard.length > 0) obstacles.add("courtyard", part.component, part.side, boxOf(part.courtyard))
  }
  for (const via of pcb.vias ?? []) {
    const r = via.diameter / 2
    obstacles.add("via", "", "both", { minX: via.at.x - r, minY: via.at.y - r, maxX: via.at.x + r, maxY: via.at.y + r })
  }
  for (const hole of pcb.holes ?? []) {
    const r = hole.diameter / 2
    obstacles.add("hole", "", "both", { minX: hole.x - r, minY: hole.y - r, maxX: hole.x + r, maxY: hole.y + r })
  }
  for (const text of pcb.silkTexts ?? []) obstacles.add("text", text.id, text.layer, silkTextBox(text))
  return obstacles
}

/** The parts each copy group holds: the same part of one sheet in every instance, turned alike. */
function copyGroups(parts: readonly PlacedFootprint[]): Map<string, PlacedFootprint[]> {
  const groups = new Map<string, PlacedFootprint[]>()
  for (const part of parts) {
    if (part.copyOf === undefined) continue
    const key = `${part.copyOf}@${sameTurn(part.rotation)}${part.side}`
    groups.set(key, [...(groups.get(key) ?? []), part])
  }
  return groups
}

/**
 * Each part's designator with the parts whose pads, and the designators, it still covers. Designators placed by
 * pcbNameAt are set first, so the others go around them. The rest follow with the parts that have the fewest clear
 * places first (then in the order of `parts`), each copy group as one, so a part with room to spare does not take the
 * one place a crowded part had; parts with no clear place at all come last.
 */
export function designatorPlacements(pcb: SilkBoard, expansion: number, clearance = DEFAULT_SILK_CLEARANCE): DesignatorPlacement[] {
  const key = `${expansion}/${clearance}`
  const kept = recalled(pcb, key)
  if (kept) return kept
  const placements = placeDesignators(pcb, expansion, clearance)
  remember(pcb, key, placements)
  return placements
}

interface Remembered {
  key: string
  parts: readonly PlacedFootprint[]
  vias: unknown
  holes: unknown
  board: unknown
  texts: unknown
  placements: DesignatorPlacement[]
}

/**
 * The check, the design and the export all ask for the same board's designators, each through a list of its own (the
 * check leaves out unplaced parts, the design adds each designator's place), so the answer is kept by the parts
 * themselves: under the first part, for the same parts in the same order on the same board.
 */
const remembered = new WeakMap<PlacedFootprint, Remembered>()

function recalled(pcb: SilkBoard, key: string): DesignatorPlacement[] | undefined {
  const first = pcb.parts[0]
  const kept = first && remembered.get(first)
  if (!kept || kept.key !== key || kept.vias !== pcb.vias || kept.holes !== pcb.holes || kept.board !== pcb.board || kept.texts !== pcb.silkTexts) return undefined
  if (kept.parts.length !== pcb.parts.length) return undefined
  for (let i = 0; i < kept.parts.length; i++) if (kept.parts[i] !== pcb.parts[i]) return undefined
  return kept.placements
}

function remember(pcb: SilkBoard, key: string, placements: DesignatorPlacement[]): void {
  const first = pcb.parts[0]
  if (first) remembered.set(first, { key, parts: pcb.parts, vias: pcb.vias, holes: pcb.holes, board: pcb.board, texts: pcb.silkTexts, placements })
}

/** The first clear place, else the first fair one (only other parts between it and its own part), in one pass. */
function goodPlace(places: readonly Place[], covered: (place: Place) => Covered): Place | undefined {
  let fair: Place | undefined
  for (const place of places) {
    const found = covered(place)
    if (found.score === 0) return place
    if (fair === undefined && found.score === found.between * BETWEEN) fair = place
  }
  return fair
}

/** How many clear and fair places a part has, counted up to ROOM_COUNT each: enough to order the parts. */
function roomAround(part: PlacedFootprint, places: readonly Place[], covered: (place: Place) => Covered): { clear: number; fair: number } {
  let [clear, fair] = [0, 0]
  for (const place of places) {
    const found = covered(place)
    if (found.score === 0) clear++
    if (found.score === found.between * BETWEEN) fair++
    if (clear >= ROOM_COUNT) break
  }
  return { clear, fair }
}

function placeDesignators(pcb: SilkBoard, expansion: number, clearance: number): DesignatorPlacement[] {
  const parts = pcb.parts.filter((part) => part.component !== "")
  const obstacles = obstaclesOf(pcb, expansion, clearance)
  const chosen = new Map<string, Place>()
  const settle = (part: PlacedFootprint, place: Place) => {
    chosen.set(part.component, place)
    obstacles.add("designator", part.component, part.side, textBox(part.component, place.at, place.rotation))
  }
  const placesOf = new Map<string, Place[]>()
  const tries = (part: PlacedFootprint): Place[] => {
    const known = placesOf.get(part.component)
    if (known) return known
    const made = placesAround(part, clearance, part.nameRotation)
    placesOf.set(part.component, made)
    return made
  }
  const clear = (part: PlacedFootprint, place: Place) => obstacles.covered(part, place).score === 0
  // A place with another part standing between it and its own part, but nothing under it, is second best.
  const fair = (part: PlacedFootprint, place: Place) => {
    const covered = obstacles.covered(part, place)
    return covered.score === covered.between * BETWEEN
  }
  const best = (part: PlacedFootprint): Place => {
    const all = tries(part)
    const free = goodPlace(all, (place) => obstacles.covered(part, place))
    if (free) return free
    let least = { place: all[0] as Place, score: Infinity }
    for (const place of all) {
      const score = obstacles.covered(part, place).score
      if (score < least.score) least = { place, score }
    }
    return least.place
  }
  for (const part of parts) if (part.nameAt) settle(part, { at: part.nameAt, rotation: part.nameRotation ?? 0 })
  const room = new Map(parts.filter((part) => !part.nameAt).map((part) => [part.component, roomAround(part, tries(part), (place) => obstacles.covered(part, place))]))
  const ordered = placingOrder(parts.filter((part) => !part.nameAt), (part) => room.get(part.component) ?? { clear: 0, fair: 0 })
  for (const members of ordered) {
    if (members.length > 1) placeCopies(members, tries, clear, best, settle)
    else settle(members[0] as PlacedFootprint, best(members[0] as PlacedFootprint))
  }
  makeRoom(parts, chosen, { tries, clear, fair, settle, covered: (part, place) => obstacles.covered(part, place), remove: (part) => obstacles.remove(part.component) })
  // What each still covers is judged against every designator, those placed after it included.
  return parts.map((part) => {
    const place = chosen.get(part.component) as Place
    const covered: Covered = obstacles.covered(part, place, false)
    return {
      component: part.component,
      side: part.side,
      at: place.at,
      rotation: place.rotation,
      coversPads: unique(covered.pads),
      coversDesignators: unique(covered.designators),
      coversParts: unique(covered.courtyards),
      coversTexts: unique(covered.texts),
      offBoard: covered.edge,
    }
  })
}

/**
 * The order the designators without a place of their own are placed in, each copy group as one: first the parts with
 * clear places, fewest first, so a part with room to spare does not take the one place a crowded part had; then those
 * whose only places have another part between them and their own; last those with no such place at all, which cover
 * something wherever they go. A copy that is more crowded than its group goes on its own; ties keep the parts' order.
 */
function placingOrder(parts: readonly PlacedFootprint[], room: (part: PlacedFootprint) => { clear: number; fair: number }): PlacedFootprint[][] {
  const tier = (part: PlacedFootprint) => (room(part).clear > 0 ? 0 : room(part).fair > 0 ? 1 : 2)
  const size = (part: PlacedFootprint) => [room(part).clear, room(part).fair, 0][tier(part)] as number
  const groupOf = new Map([...copyGroups(parts).values()].flatMap((members) => members.map((member) => [member.component, members] as const)))
  const units: PlacedFootprint[][] = []
  const seen = new Set<string>()
  for (const part of parts) {
    if (seen.has(part.component)) continue
    const members = groupOf.get(part.component) ?? [part]
    members.forEach((member) => seen.add(member.component))
    const roomy = members.filter((member) => tier(member) === 0)
    if (roomy.length > 0) units.push(roomy)
    units.push(...members.filter((member) => tier(member) > 0).map((member) => [member]))
  }
  const key = (members: readonly PlacedFootprint[]) => ({ tier: Math.max(...members.map(tier)), size: Math.min(...members.map(size)) })
  return units
    .map((members, i) => ({ members, i, ...key(members) }))
    .sort((a, b) => a.tier - b.tier || a.size - b.size || a.i - b.i)
    .map((unit) => unit.members)
}

/** How many of a crowded part's places are tried when moving the designators in their way. */
const ROOM_TRIES = 4
/** Clear places counted per part to order them; more than this is plenty of room. */
const ROOM_COUNT = 12
/** How many times the second pass goes over the board: a move can open room for a part met before it. */
const ROOM_PASSES = 2

interface Placer {
  tries: (part: PlacedFootprint) => Place[]
  clear: (part: PlacedFootprint, place: Place) => boolean
  fair: (part: PlacedFootprint, place: Place) => boolean
  settle: (part: PlacedFootprint, place: Place) => void
  covered: (part: PlacedFootprint, place: Place) => Covered
  remove: (part: PlacedFootprint) => void
}

/**
 * A second pass for each designator that found no clear place: it takes a place where only other designators are in
 * the way when each of those can move to a clear place of its own. Designators placed by pcbNameAt never move.
 */
function makeRoom(parts: readonly PlacedFootprint[], chosen: Map<string, Place>, placer: Placer): void {
  const byName = new Map(parts.map((part) => [part.component, part]))
  const pinned = new Set(parts.filter((part) => part.nameAt).map((part) => part.component))
  for (let pass = 0; pass < ROOM_PASSES; pass++) {
    let changed = false
    for (const part of parts) {
      const now = chosen.get(part.component) as Place
      if (pinned.has(part.component) || placer.clear(part, now)) continue
      const wasFair = placer.fair(part, now)
      placer.remove(part)
      const found = goodPlace(placer.tries(part), (place) => placer.covered(part, place))
      const free = found && (placer.clear(part, found) || !wasFair) ? found : undefined
      const open: Place[] = []
      for (const place of free ? [] : placer.tries(part)) {
        const covered = placer.covered(part, place)
        if (covered.fixed === 0 && (covered.between === 0 || !wasFair) && !covered.designators.some((name) => pinned.has(name))) open.push(place)
        if (open.length >= ROOM_TRIES) break
      }
      if (free) placer.settle(part, free)
      const moved = free !== undefined || open.some((place) => tryMoving(part, place, byName, chosen, placer))
      if (!moved) placer.settle(part, now)
      changed ||= moved
    }
    if (!changed) return
  }
}

/** Puts `part` at `place` and moves the designators in its way to clear places; puts everything back when one cannot move. */
function tryMoving(part: PlacedFootprint, place: Place, byName: ReadonlyMap<string, PlacedFootprint>, chosen: Map<string, Place>, placer: Placer): boolean {
  const blockers = unique(placer.covered(part, place).designators).map((name) => byName.get(name) as PlacedFootprint)
  const before = blockers.map((blocker) => [blocker, chosen.get(blocker.component) as Place] as const)
  blockers.forEach(placer.remove)
  placer.settle(part, place)
  const moved: PlacedFootprint[] = []
  for (const blocker of blockers) {
    const free = goodPlace(placer.tries(blocker), (option) => placer.covered(blocker, option))
    if (!free) break
    placer.settle(blocker, free)
    moved.push(blocker)
  }
  if (moved.length === blockers.length) return true
  moved.forEach(placer.remove)
  placer.remove(part)
  before.forEach(([blocker, was]) => placer.settle(blocker, was))
  return false
}

/**
 * The copies of one part take the first place (in the first copy's order) that is clear round every one of them; when
 * there is none, the place clear round the most of them goes to those, and the others take their own best.
 */
function placeCopies(
  members: readonly PlacedFootprint[],
  tries: (part: PlacedFootprint) => Place[],
  clear: (part: PlacedFootprint, place: Place) => boolean,
  best: (part: PlacedFootprint) => Place,
  settle: (part: PlacedFootprint, place: Place) => void,
): void {
  const lists = members.map(tries)
  const count = Math.min(...lists.map((list) => list.length))
  const fitsAll = (i: number) => members.every((member, m) => clear(member, lists[m]?.[i] as Place)) && copiesApart(members, lists, i)
  for (let i = 0; i < count; i++) {
    if (!fitsAll(i)) continue
    members.forEach((member, m) => settle(member, lists[m]?.[i] as Place))
    return
  }
  // No place suits them all: the place clear for the most copies goes to those, one by one, and the rest find their own.
  let most = { index: -1, clear: 0 }
  for (let i = 0; i < count; i++) {
    const fits = members.filter((member, m) => clear(member, lists[m]?.[i] as Place)).length
    if (fits > most.clear) most = { index: i, clear: fits }
  }
  const rest: PlacedFootprint[] = []
  members.forEach((member, m) => {
    const same = most.index >= 0 ? lists[m]?.[most.index] : undefined
    if (same && clear(member, same)) settle(member, same)
    else rest.push(member)
  })
  rest.forEach((member) => settle(member, best(member)))
}

/** Whether the copies' texts at place `i` keep clear of one another (they are not obstacles to each other yet). */
function copiesApart(members: readonly PlacedFootprint[], lists: readonly Place[][], i: number): boolean {
  const boxes = members.map((member, m) => {
    const place = lists[m]?.[i] as Place
    return textBox(member.component, place.at, place.rotation)
  })
  return boxes.every((a, j) => boxes.every((b, k) => k <= j || !(a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY)))
}

/** The board with each part's designator place (`designatorAt`) and turn (`designatorRotation`), where the export draws it. */
export function withDesignators(pcb: PcbLayout, fabrication: FabricationProfile): PcbLayout {
  const [expansion, clearance] = [fabrication.maskExpansion ?? DEFAULT_MASK_EXPANSION, silkClearance(fabrication)]
  const placements = designatorPlacements(pcb, expansion, clearance)
  const placed = new Map(placements.map((p) => [p.component, p]))
  const board = {
    ...pcb,
    parts: pcb.parts.map((part) => {
      const found = placed.get(part.component)
      return found ? { ...part, designatorAt: found.at, designatorRotation: found.rotation } : part
    }),
  }
  // The places do not depend on designatorAt, so the board that carries them has the same answer.
  remember(board, `${expansion}/${clearance}`, placements)
  return board
}

/** The gap a profile keeps silkscreen from pads, used for designators too. */
export const silkClearance = (fabrication: Pick<FabricationProfile, "minSilkToPad">) => fabrication.minSilkToPad ?? DEFAULT_SILK_CLEARANCE

/** Where the Studio draws a part's designator: pcbNameAt's place, else the place the design carries, else above the courtyard. */
export const designatorAnchor = (part: PlacedFootprint): Point => part.nameAt ?? part.designatorAt ?? (placesAround(part, DEFAULT_SILK_CLEARANCE, 0).find((p) => p.at.y > part.y)?.at ?? { x: part.x, y: part.y })

/** The turn the Studio draws a part's designator with: pcbNameRotation's, else the design's, else flat. */
export const designatorTurn = (part: PlacedFootprint): DesignatorTurn => (part.nameAt ? part.nameRotation : undefined) ?? part.designatorRotation ?? part.nameRotation ?? 0

const possessive = (name: string) => `${name}'s`

/** A designator that still covers pads or another designator, and the sentence that says so. */
export interface SilkscreenFinding extends DesignatorPlacement {
  /** "C1's silkscreen overlaps U1's pads and R3's designator" */
  message: string
}

/**
 * Each designator that covers pads, another designator, another part's courtyard or the board's edge, in designator order. The one source of
 * both the export's warnings and check_circuit's `silk-on-pad` findings for designators, so the two name the same parts.
 */
export function silkscreenFindings(pcb: SilkBoard, fabrication: FabricationProfile): SilkscreenFinding[] {
  // A part with no courtyard and no pcbNameAt has its designator on its own centre, over its own pads: there is no
  // side to put it on, and nothing to say.
  const shaped = new Set(pcb.parts.filter((part) => part.courtyard.length > 0 || part.nameAt).map((part) => part.component))
  const textOf = new Map((pcb.silkTexts ?? []).map((text) => [text.id, text.text]))
  return designatorPlacements(pcb, fabrication.maskExpansion ?? DEFAULT_MASK_EXPANSION, silkClearance(fabrication))
    .filter((p) => shaped.has(p.component) && (p.coversPads.length > 0 || p.coversDesignators.length > 0 || p.coversParts.length > 0 || p.coversTexts.length > 0 || p.offBoard))
    .sort((a, b) => naturalCompare(a.component, b.component))
    .map((p) => {
      const items = [
        ...(p.coversPads.length > 0 ? [`${listed(p.coversPads.map(possessive))} pads`] : []),
        ...(p.coversDesignators.length > 0 ? [`${listed(p.coversDesignators.map(possessive))} ${p.coversDesignators.length === 1 ? "designator" : "designators"}`] : []),
        ...(p.coversParts.length > 0 ? [`${listed(p.coversParts.map(possessive))} ${p.coversParts.length === 1 ? "courtyard" : "courtyards"}`] : []),
        ...(p.coversTexts.length > 0 ? [`the ${p.coversTexts.length === 1 ? "text" : "texts"} ${listed(p.coversTexts.map((id) => `"${textOf.get(id) ?? id}"`))}`] : []),
        ...(p.offBoard ? ["the board's edge"] : []),
      ]
      return { ...p, message: `${p.component}'s silkscreen overlaps ${listed(items)}` }
    })
}

/** A warning for each designator that covers pads or another designator, in designator order: "C1's silkscreen overlaps U1's pads". */
export function silkscreenWarnings(pcb: SilkBoard, fabrication: FabricationProfile): string[] {
  return silkscreenFindings(pcb, fabrication).map((finding) => finding.message)
}

/** "a", "a and b", "a, b and c". */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}
