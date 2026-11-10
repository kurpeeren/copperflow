// What the hover label names: the pad, via or track under the pointer on the PCB, the pin end, net label, wire or sheet
// symbol pin on the schematic, and the text it shows. It asks the pick functions a click asks (copper-hit.ts copperAt,
// pcb-draw.ts padAt, gestures.ts targetAt, wire-tool.ts pinAt) in a click's order, so the label always names what a
// click would select. HoverLabel.tsx shows it. Plain TypeScript with .js imports, so the tests run it without a DOM.
import type { Design } from "../../../src/engine/design.js"
import type { Pin } from "../../../src/engine/model.js"
import type { PcbTrack, PcbVia, WorldPad } from "../../../src/engine/pcb.js"
import type { NetLabel } from "../../../src/engine/schematic.js"
import { copperAt, copperReach } from "./copper-hit.js"
import type { PartBox, Point } from "./geometry.js"
import { targetAt, textTakesPress, type GestureDrawings, type GestureLabels, type GestureTexts, type GestureWires } from "./gestures.js"
import type { PickLayers } from "./layers.js"
import { padAt, padDistance } from "./pcb-draw.js"
import { canPick, type PickContext } from "./pick.js"
import { segmentAt } from "./wire-hit.js"
import { labelOf, pinAt, PIN_REACH_PX } from "./wire-tool.js"

/** What the label is about, by the id the design gives it, and what it says. */
export interface HoverTarget {
  kind: "pad" | "via" | "track" | "pin" | "port" | "label" | "wire"
  id: string
  text: string
  /** A net label or wire over a pin end: that pin's id, which its text names too. */
  pin?: string
}

/** The PCB as the label sees it: the copper as shown, the camera's scale (CSS pixels per mm) and what a click picks with. */
export interface PcbHoverScene {
  view: "pcb"
  design: Pick<Design, "circuit" | "pcb">
  copper: { tracks: readonly PcbTrack[]; vias: readonly PcbVia[] }
  scale: number
  layers: PickLayers
  context: PickContext
  boxes: readonly PartBox[]
  /** The designators, which take a click before the copper and pads under them. */
  texts?: Pick<GestureTexts, "at">
}

/** The schematic as the label sees it: the hit tests the canvas gives a click (gestures.ts targetAt). */
export interface SheetHoverScene {
  view: "schematic"
  design: Pick<Design, "circuit" | "schematic">
  scale: number
  context: PickContext
  boxes: readonly PartBox[]
  labels?: Pick<GestureLabels, "at">
  wires?: Pick<GestureWires, "at">
  drawings?: Pick<GestureDrawings, "at">
  texts?: Pick<GestureTexts, "at">
}

export type HoverScene = PcbHoverScene | SheetHoverScene

const SEP = " · "

/** A net's first name; "no net" without one; a net the circuit does not list (a sheet symbol's) by the name in its id. */
function netText(design: Pick<Design, "circuit">, id: string | undefined): string {
  if (id === undefined) return "no net"
  const net = design.circuit.nets.find((one) => one.id === id)
  if (net) return net.names[0] ?? id
  return id.startsWith("net.") ? id.slice("net.".length) : id
}

/** A width in mm as it is written, without float noise: 0.25, not 0.25000000000000006. */
const mm = (value: number): string => `${Number(value.toFixed(4))} mm`

const componentOf = (design: Pick<Design, "circuit">, id: string) => design.circuit.components.find((one) => one.id === id)

/** "U1.5 VOUT · V3_3": the part, the pad number, the pin's own name, the net; an instance's part adds "[PS1]". */
function padText(design: Pick<Design, "circuit">, pad: WorldPad): string {
  const component = componentOf(design, pad.component)
  const pin = component?.pins.find((one) => one.id === pad.pin)
  const name = pin && labelOf(component?.props ?? {}, pin.number)
  const instance = component?.instance === undefined ? "" : ` [${component.instance}]`
  return `${pad.component}.${pad.number}${name ? ` ${name}` : ""}${SEP}${netText(design, pad.net)}${instance}`
}

const viaText = (design: Pick<Design, "circuit">, via: PcbVia): string => `via ${via.id}${SEP}${netText(design, via.net)}${SEP}${via.layers[0]}–${via.layers.at(-1)}`

function trackText(design: Pick<Design, "circuit">, track: PcbTrack): string {
  return `track ${track.id}${SEP}${netText(design, track.net)}${SEP}${mm(track.width)}${SEP}${track.layer}${track.by === "router" ? `${SEP}routed` : ""}`
}

/** On the PCB: a designator takes the click, so nothing; then the via or track, then the pad of a part that may be picked. */
function pcbTarget(world: Point, scene: PcbHoverScene): HoverTarget | undefined {
  const { design, copper, scale, layers, context } = scene
  if (textTakesPress(scene.boxes, world, context, scene.texts)) return undefined
  const hit = copperAt(copper, world, scale, layers.visible, context)
  const via = hit?.kind === "via" ? copper.vias.find((one) => one.id === hit.id) : undefined
  if (via) return { kind: "via", id: via.id, text: viaText(design, via) }
  const track = hit?.kind === "track" ? copper.tracks.find((one) => one.id === hit.id) : undefined
  if (track) return { kind: "track", id: track.id, text: trackText(design, track) }
  const pad = padAt(design.pcb, world, layers.visible, (name) => canPick({ kind: "part", name }, context))
  return pad && { kind: "pad", id: pad.id, text: padText(design, pad) }
}

/** The name a net label or flag stands for: its text when the net has that name, else the net's first name. */
function labelText(design: Pick<Design, "circuit">, label: NetLabel): string {
  const net = design.circuit.nets.find((one) => one.id === label.net)
  return net?.names.includes(label.text) ? label.text : (net?.names[0] ?? label.text)
}

/** "U1.VOUT": the part and the pin's own name, else pinN. */
const pinName = (design: Pick<Design, "circuit">, pin: Pin): string => `${pin.component}.${labelOf(componentOf(design, pin.component)?.props ?? {}, pin.number) ?? `pin${pin.number}`}`

/** "U1.VOUT · V3_3": the pin and its net. */
function pinText(design: Pick<Design, "circuit">, pin: Pin): string {
  const net = design.circuit.nets.find((one) => one.pins.includes(pin.id))
  return `${pinName(design, pin)}${SEP}${netText(design, net?.id)}`
}

/** A sheet symbol's pin, "PS1.VIN · VBUS", or a bus pin, "PS1.D · bus D[0:7]". */
function portTarget(design: Pick<Design, "circuit">, id: string): HoverTarget | undefined {
  for (const instance of design.circuit.instances ?? []) {
    const port = instance.ports.find((one) => `${instance.path}.${one.name}` === id)
    if (port) return { kind: "port", id, text: `${id}${SEP}${port.bus ? `bus ${port.net}` : port.net}` }
  }
  return undefined
}

/** The pin end within reach whose part may be picked: a part's pin, else a sheet symbol's. */
function pinTarget(world: Point, scene: SheetHoverScene): HoverTarget | undefined {
  const { design } = scene
  const hit = pinAt(design as Design, world, PIN_REACH_PX / scene.scale)
  const symbol = hit && design.schematic.symbols.find((one) => hit.pin in one.pinEnds)
  if (!hit || !symbol || !canPick({ kind: "part", name: symbol.component }, scene.context)) return undefined
  const pin = componentOf(design, symbol.component)?.pins.find((one) => one.id === hit.pin)
  return pin ? { kind: "pin", id: pin.id, text: pinText(design, pin) } : portTarget(design, hit.pin)
}

/** A net label or wire picked over a pin end keeps the click's target and adds the pin: "TXCAN · pin U1.TXCAN". */
function withPin(target: HoverTarget, world: Point, scene: SheetHoverScene): HoverTarget {
  const pin = pinTarget(world, scene)
  if (!pin) return target
  const name = pin.text.slice(0, pin.text.indexOf(SEP))
  return { ...target, text: `${target.text}${SEP}pin ${name}`, pin: pin.id }
}

/**
 * On the schematic: what a click picks (a net label, then a wire), with a drawn line over everything else; then a pin
 * end, before the symbol it belongs to; a symbol's body, a name or the sheet has no label.
 */
function sheetTarget(world: Point, scene: SheetHoverScene): HoverTarget | undefined {
  const { design } = scene
  const clicked = targetAt(scene.boxes, scene.labels, world, scene.context, scene.wires, scene.drawings, scene.texts)
  if (clicked.kind === "label") return withPin({ kind: "label", id: clicked.label.id, text: labelText(design, clicked.label) }, world, scene)
  if (clicked.kind === "wire") {
    const wire = design.schematic.wires.find((one) => one.id === clicked.id)
    return withPin({ kind: "wire", id: clicked.id, text: `wire${SEP}${netText(design, wire?.net)}` }, world, scene)
  }
  return clicked.kind === "drawing" ? undefined : pinTarget(world, scene)
}

/** What the label under the pointer at `world` names, and its text; undefined where a click would pick nothing it labels. */
export function hoverTarget(world: Point, scene: HoverScene): HoverTarget | undefined {
  return scene.view === "pcb" ? pcbTarget(world, scene) : sheetTarget(world, scene)
}

/** Whether the pointer at `world` is still over the pad, via or track it names, by that one's own shape. */
function stillOnBoard(target: HoverTarget, world: Point, scene: PcbHoverScene): boolean {
  const { copper, scale } = scene
  if (target.kind === "via") {
    const via = copper.vias.find((one) => one.id === target.id)
    return via !== undefined && Math.hypot(world.x - via.at.x, world.y - via.at.y) <= copperReach(via.diameter, scale)
  }
  if (target.kind === "track") {
    const track = copper.tracks.find((one) => one.id === target.id)
    return track !== undefined && segmentAt(track.points, world, copperReach(track.width, scale)) !== undefined
  }
  const component = target.id.slice(0, target.id.indexOf("#"))
  const pad = scene.design.pcb.parts.find((part) => part.component === component)?.pads.find((one) => one.id === target.id)
  return target.kind === "pad" && pad !== undefined && padDistance(pad, world) <= 0
}

/** Whether the pointer at `world` is still over the label, wire or pin end it names (and the pin a label or wire adds). */
function stillOnSheet(target: HoverTarget, world: Point, scene: SheetHoverScene): boolean {
  const reach = PIN_REACH_PX / scene.scale
  const nearPin = (id: string) => {
    const end = scene.design.schematic.symbols.find((symbol) => id in symbol.pinEnds)?.pinEnds[id]
    return end !== undefined && Math.hypot(world.x - end.x, world.y - end.y) <= reach
  }
  const pinStays = target.pin === undefined || nearPin(target.pin)
  if (target.kind === "label") return scene.labels?.at(world)?.id === target.id && pinStays
  if (target.kind === "wire") return scene.wires?.at(world) === target.id && pinStays
  return nearPin(target.id)
}

/**
 * Whether the pointer at `world` is still over `target`, asked of that one thing alone: the cheap check a move makes
 * while the label shows, so moving the pointer costs no full pick (hover-rest.ts).
 */
export function stillOver(target: HoverTarget, world: Point, scene: HoverScene): boolean {
  return scene.view === "pcb" ? stillOnBoard(target, world, scene) : stillOnSheet(target, world, scene)
}
