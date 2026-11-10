// The width and via a track drawn by hand (the Studio's track tool, the agent's route_track) gets: the net's class from
// rules.yaml when one claims it, else the design rules' default class, never below the fabrication profile's minimums
// (the copper checks require them, so copper drawn with the defaults never fails its own check).
import type { Net } from "../model.js"
import { classOfNet } from "./classes.js"
import { DEFAULT_CLASS } from "./profiles.js"
import type { NetClass, Rules } from "./schema.js"

/** A via's drill and diameter in mm. */
export interface ViaSize {
  drill: number
  diameter: number
}

const classFor = (rules: Rules, net: Net): NetClass => rules.classes.find((one) => one.name === classOfNet(rules, net)) ?? DEFAULT_CLASS

/** The width in mm: the net class's, else the default class's, raised to the fabrication minimum when below it. */
export const trackWidth = (rules: Rules, net: Net): number => Math.max(classFor(rules, net).trackWidth, rules.fabrication.minTrackWidth)

/** Rounds to a thousandth of a micrometre, so 0.3 + 2 × 0.18 is 0.66, not 0.6599999999999999. */
const toNanometre = (mm: number): number => Math.round(mm * 1e6) / 1e6

function ringSafe(rules: Rules, via: ViaSize): ViaSize {
  const drill = Math.max(via.drill, rules.fabrication.minDrill)
  return { drill, diameter: Math.max(via.diameter, toNanometre(drill + 2 * rules.fabrication.minAnnularRing)) }
}

/**
 * The via's drill and diameter in mm: the net class's, else the default class's; the drill is raised to the fabrication
 * profile's minimum drill, and the diameter grows to the drill plus its minimum annular ring on both sides, so a via
 * placed this way never fails the drill or ring check.
 */
export const viaSize = (rules: Rules, net: Net): ViaSize => ringSafe(rules, classFor(rules, net).via)

/** The via placed on no net: the default class's, raised and grown like viaSize. */
export const defaultVia = (rules: Rules): ViaSize => ringSafe(rules, DEFAULT_CLASS.via)

/** The fillet radius when rules.yaml sets none, in mm. */
export const DEFAULT_FILLET_RADIUS = 1

/** The radius Fillet tracks rounds corners with: rules.yaml's fabrication.filletRadius, else 1 mm. A track's width is its floor. */
export const filletRadius = (rules: Rules): number => rules.fabrication.filletRadius ?? DEFAULT_FILLET_RADIUS
