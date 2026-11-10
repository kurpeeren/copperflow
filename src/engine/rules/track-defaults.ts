// The width and via a track drawn by hand (the Studio's track tool, the agent's route_track) gets: the net's class from
// rules.yaml when one claims it, else the design rules' default class.
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

/** The width in mm: the net class's, else the default class's. */
export const trackWidth = (rules: Rules, net: Net): number => classFor(rules, net).trackWidth

/** Rounds to a thousandth of a micrometre, so 0.3 + 2 × 0.18 is 0.66, not 0.6599999999999999. */
const toNanometre = (mm: number): number => Math.round(mm * 1e6) / 1e6

function ringSafe(rules: Rules, { drill, diameter }: ViaSize): ViaSize {
  return { drill, diameter: Math.max(diameter, toNanometre(drill + 2 * rules.fabrication.minAnnularRing)) }
}

/**
 * The via's drill and diameter in mm: the net class's, else the default class's; the diameter grows to the drill plus
 * the fabrication profile's minimum annular ring on both sides, so a via placed this way never fails the ring check.
 */
export const viaSize = (rules: Rules, net: Net): ViaSize => ringSafe(rules, classFor(rules, net).via)

/** The via placed on no net: the default class's, grown like viaSize. */
export const defaultVia = (rules: Rules): ViaSize => ringSafe(rules, DEFAULT_CLASS.via)
