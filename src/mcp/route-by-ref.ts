// route_track by reference: its ends named as pads ("C3.pin2", or a pin's name such as "U2.GND"), resolved to the pad
// centres. With corner points between them (`via`) the track is drawn on one layer through them; with none, the router's
// single-connection search finds the path (tracks and vias) and it is written as one change, or refused naming what is
// in the way.
import type { LayoutEdit } from "../core/index.js"
import type { CopperLayer } from "../core/layout-file.js"
import type { Design } from "../engine/design.js"
import type { Point } from "../engine/model.js"
import { padPlace } from "../engine/pad-text.js"
import type { WorldPad } from "../engine/pcb.js"
import { routeConnection } from "../engine/router/connect.js"
import { routeInput } from "../studio/route-runner.js"

/** The pad a reference names: by its pin ("C3.pin2"), a pin name ("U2.GND"), or its pad id ("C3#2"). */
export function padByRef(design: Design, ref: string): WorldPad {
  const pads = design.pcb.parts.flatMap((part) => part.pads)
  const exact = pads.find((pad) => pad.pin === ref || pad.id === ref)
  if (exact) return exact
  if (ref.includes("/")) return padByRef(design, flatRef(design, ref))
  const dot = ref.indexOf(".")
  const [part, name] = dot < 0 ? [ref, ""] : [ref.slice(0, dot), ref.slice(dot + 1)]
  const component = design.circuit.components.find((one) => one.id === part)
  if (component === undefined) throw new Error(`The circuit has no part ${part} (in "${ref}"); name a pad as C3.pin2. Nothing was written.`)
  const pins = component.pins.filter((pin) => pin.names.some((one) => one.toLowerCase() === name.toLowerCase()))
  if (pins.length > 1) throw new Error(`${ref} names ${pins.length} pins (${pins.map((pin) => pin.id).join(", ")}); give one as ${part}.pinN. Nothing was written.`)
  const pad = pins[0] === undefined ? undefined : pads.find((one) => one.pin === pins[0]?.id)
  if (pad === undefined) {
    const real = component.pins.map((pin) => (pin.names.length > 0 ? `${pin.id} (${pin.names.join("/")})` : pin.id))
    throw new Error(`${part} has no pin ${name || "(none named)"}; its pins are ${real.join(", ")}. Nothing was written.`)
  }
  return pad
}

/** "PS1/R1.pin2" as the flattened "R101.pin2": the designator inside the instance plus its designator base. */
function flatRef(design: Design, ref: string): string {
  const cut = ref.lastIndexOf("/")
  const [path, local] = [ref.slice(0, cut), ref.slice(cut + 1)]
  const instance = design.circuit.instances?.find((one) => one.path === path)
  if (instance === undefined) throw new Error(`The circuit has no sub-sheet instance ${path} (in "${ref}"). Nothing was written.`)
  const found = /^([A-Za-z_]+)(\d+)(\..+)?$/.exec(local)
  if (found === null) throw new Error(`"${local}" in "${ref}" is not a designator with a number, such as R1.pin2. Nothing was written.`)
  return `${found[1]}${Number(found[2]) + instance.designatorBase}${found[3] ?? ""}`
}

/** The layer the two pads share: a surface pad's own, a through pad's either (top unless asked); refused when they share none. */
export function sharedLayer(from: WorldPad, to: WorldPad, asked: CopperLayer | undefined): CopperLayer {
  const fits = (pad: WorldPad, layer: CopperLayer) => pad.layers === "through" || pad.layers === layer
  const surface = [from, to].find((pad) => pad.layers !== "through")?.layers as CopperLayer | undefined
  const layer = asked ?? surface ?? "top"
  if (fits(from, layer) && fits(to, layer)) return layer
  throw new Error(`${padPlace(from)} and ${padPlace(to)} are not both on ${layer}; route them with from and to only (the router adds vias), or draw two tracks and a via. Nothing was written.`)
}

export interface ByRef {
  net: string
  from: WorldPad
  to: WorldPad
}

/** The two pads and their net; refused when they are on no net or on different nets, or the net given is another. */
export function endsByRef(design: Design, from: string, to: string, net: string | undefined, netId: (name: string) => string): ByRef {
  const [a, b] = [padByRef(design, from), padByRef(design, to)]
  if (a.net === undefined || a.net !== b.net) throw new Error(`${padPlace(a)} and ${padPlace(b)} are not on one net. Nothing was written.`)
  if (net !== undefined && netId(net) !== a.net) throw new Error(`${from} and ${to} are on ${a.net.replace(/^net[.:]/, "")}, not ${net}. Nothing was written.`)
  return { net: a.net, from: a, to: b }
}

/** The corners of a track from one pad centre through the points given to the other. */
export const cornersOf = (ends: ByRef, via: readonly Point[]): Point[] => [{ x: ends.from.x, y: ends.from.y }, ...via, { x: ends.to.x, y: ends.to.y }]

/** The router's path between the two pads as layout edits, or an error naming what is in the way. */
export function searchedEdits(design: Design, ends: ByRef, netName: string): LayoutEdit[] {
  const result = routeConnection(routeInput(design), ends.from.id, ends.to.id)
  if (!result.routed) {
    const found = /^could not route .+?: (.+)$/.exec(result.reason)
    throw new Error(`Could not route ${padPlace(ends.from)} to ${padPlace(ends.to)}: ${found ? found[1] : result.reason}. Move a part, or give via points. Nothing was written.`)
  }
  const tracks = result.copper.tracks.map((track): LayoutEdit => ({ kind: "addTrack", net: netName, layer: track.layer, width: track.width, points: track.points }))
  const vias = result.copper.vias.map((via): LayoutEdit => ({ kind: "addVia", net: netName, at: via.at, drill: via.drill, diameter: via.diameter, layers: [...via.layers] }))
  return [...tracks, ...vias]
}
