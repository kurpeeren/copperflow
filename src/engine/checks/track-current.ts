// Track width for current. A net carries the largest current a sheet port on it names in its `carries` text ("10 A at
// most", "33 mA"), or its net class's `current`, whichever is larger. IPC-2221 gives the width that current needs for a
// 10 °C rise in the board's copper (fabrication.copperThickness, 1 oz when not set); each net with tracks narrower than
// that is one `track-current` warning naming those tracks. Vias are not measured; pours are, in pour-current.ts. Pure.
import type { Circuit, Net } from "../model.js"
import type { PcbLayout, PcbTrack } from "../pcb.js"
import { netClasses } from "../rules/classes.js"
import type { Rules } from "../rules/schema.js"
import { violation, type Violation } from "./violation.js"

/** The temperature rise the width is worked out for, in °C. */
export const TEMPERATURE_RISE = 10
/** 1 oz copper, in mm, when the rules give no thickness. */
export const ONE_OUNCE = 0.035
/** IPC-2221's constant for outer and inner layers (I in A, ΔT in °C, area in square mils). */
const K = { outer: 0.048, inner: 0.024 } as const
const MIL = 0.0254
const WIDTH_TOLERANCE = 1e-6

export type CopperSide = keyof typeof K

const UNITS: Readonly<Record<string, number>> = { a: 1, ma: 1e-3, µa: 1e-6, μa: 1e-6, ua: 1e-6 }
/**
 * A number and a current unit, standing alone: "10 A", "33mA", "2,5 A"; not "250 VAC", "2 Ah", "500 mAh", or a part
 * number such as LM2596A (the number must not follow a letter, digit or decimal mark).
 */
const CURRENT = /(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)?)\s*(mA|µA|μA|uA|A)(?![\p{L}\p{N}])/gu

/** The largest current a text names, in amperes; none when it names none. */
export function currentIn(text: string): number | undefined {
  const amps = [...text.matchAll(CURRENT)].map((match) => Number((match[1] as string).replace(",", ".")) * (UNITS[(match[2] as string).toLowerCase()] as number))
  return amps.length === 0 ? undefined : Math.max(...amps)
}

/** The track width in mm that carries `amps` with a 10 °C rise in copper `thickness` mm thick (IPC-2221). */
export function widthForCurrent(amps: number, thickness: number, side: CopperSide): number {
  const area = (amps / (K[side] * TEMPERATURE_RISE ** 0.44)) ** (1 / 0.725)
  return (area / (thickness / MIL)) * MIL
}

export interface NetCurrent {
  amps: number
  /** Where the current is said: a port and its text, or a net class. */
  from: string
}

const netByName = (nets: readonly Net[]): Map<string, Net> => new Map(nets.flatMap((net) => net.names.map((name) => [name, net] as const)))

/** Each port's current, by the net it is on: the instances' ports, and the sheet's own when the file built is a sheet. */
function portCurrents(circuit: Circuit): { net: Net; current: NetCurrent }[] {
  const byName = netByName(circuit.nets)
  const said = [
    ...(circuit.instances ?? []).flatMap((instance) => instance.ports.filter((port) => port.members === undefined).map((port) => ({ net: port.net, carries: port.carries, who: `${instance.name} port ${port.name}` }))),
    ...(circuit.sheet?.ports ?? []).filter((port) => port.bus !== true).map((port) => ({ net: port.name, carries: port.carries, who: `port ${port.name}` })),
  ]
  return said.flatMap(({ net, carries, who }) => {
    const amps = carries === undefined ? undefined : currentIn(carries)
    const found = byName.get(net)
    return amps === undefined || found === undefined ? [] : [{ net: found, current: { amps, from: `${who}: "${carries}"` } }]
  })
}

/** Each net's current, by net id: the largest any port on it or its class says. */
export function netCurrents(circuit: Circuit, rules: Rules): Map<string, NetCurrent> {
  const currents = new Map<string, NetCurrent>()
  const keep = (net: string, current: NetCurrent) => {
    if (current.amps > (currents.get(net)?.amps ?? 0)) currents.set(net, current)
  }
  for (const { net, current } of portCurrents(circuit)) keep(net.id, current)
  const classAmps = new Map(rules.classes.flatMap((netClass) => (netClass.current === undefined ? [] : [[netClass.name, netClass.current] as const])))
  if (classAmps.size > 0) {
    for (const [net, name] of netClasses(rules, circuit.nets).byNet) {
      const amps = classAmps.get(name)
      if (amps !== undefined) keep(net, { amps, from: `net class ${name}` })
    }
  }
  return currents
}

const sideOf = (track: PcbTrack): CopperSide => (track.layer === "top" || track.layer === "bottom" ? "outer" : "inner")
export const mm = (value: number): string => `${Number(value.toFixed(3))}`

function narrowTracks(name: string, current: NetCurrent, tracks: readonly PcbTrack[], thickness: number): Violation[] {
  const need = { outer: widthForCurrent(current.amps, thickness, "outer"), inner: widthForCurrent(current.amps, thickness, "inner") }
  const narrow = tracks.filter((track) => track.width < need[sideOf(track)] - WIDTH_TOLERANCE)
  if (narrow.length === 0) return []
  const widths = narrow.map((track) => track.width)
  const [low, high] = [Math.min(...widths), Math.max(...widths)]
  const sides = [...new Set(narrow.map(sideOf))]
  const needs = sides.map((side) => `${need[side].toFixed(2)} mm on ${side === "outer" ? "an outer" : "an inner"} layer`).join(" and ")
  const seen = narrow.length === 1 ? `1 track is ${mm(low)} mm` : `${narrow.length} tracks are ${low === high ? mm(low) : `${mm(low)} to ${mm(high)}`} mm`
  const message =
    `${name} carries ${mm(current.amps)} A (${current.from}): for a ${TEMPERATURE_RISE} °C rise in ${mm(thickness)} mm copper its tracks need ` +
    `${needs} (IPC-2221), but ${seen}. Give ${name} a net class with that trackWidth, then unroute and autoroute it; or carry it in a pour`
  return [violation("track-current", "warning", message, narrow.map((track) => track.id), "pcb")]
}

/** One `track-current` warning per net whose tracks are too narrow for the current it carries. */
export function trackCurrentChecks(circuit: Circuit, layout: PcbLayout, rules: Rules): Violation[] {
  const currents = netCurrents(circuit, rules)
  if (currents.size === 0) return []
  const thickness = rules.fabrication.copperThickness ?? ONE_OUNCE
  return circuit.nets.flatMap((net) => {
    const current = currents.get(net.id)
    if (current === undefined) return []
    const tracks = layout.tracks.filter((track) => track.net === net.id)
    return narrowTracks(net.names[0] ?? net.id.replace(/^net\./, ""), current, tracks, thickness)
  })
}
