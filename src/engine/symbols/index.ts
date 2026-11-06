import type { Component, Pin } from "../model.js"
import { boxDrawing, pinLabel } from "./box.js"
import { battery, capacitor, crystal, fuse, inductor, potentiometer, pushbutton, resistor, switchSymbol, testpoint } from "./passives.js"
import { diode, led, mosfet, transistor } from "./semis.js"
import { boundsOf, pt, text, type Drawing, type SchSymbol, type Shape, type SymbolPin } from "./types.js"

export { groundSymbol, powerSymbol } from "./power.js"
export type { Anchor, Bounds, SchSymbol, Shape, SymbolPin } from "./types.js"

/** Kinds with a drawing of their own. Every other kind gets a box. */
const DRAWINGS: Readonly<Record<string, (component: Component) => Drawing>> = {
  resistor,
  capacitor,
  inductor,
  fuse,
  crystal,
  switch: switchSymbol,
  diode,
  led,
  battery,
  potentiometer,
  pushbutton,
  testpoint,
  transistor,
  mosfet,
}

/** Distance between the body and the reference or value text. */
const LABEL_GAP = 0.12

const samePins = (drawing: Drawing, pins: readonly Pin[]): boolean => {
  const drawn = Object.keys(drawing.places).map(Number).sort((a, b) => a - b)
  const wanted = pins.map((pin) => pin.number).sort((a, b) => a - b)
  return drawn.length === wanted.length && drawn.every((number, index) => number === wanted[index])
}

function drawingFor(component: Component): Drawing {
  const draw = Object.hasOwn(DRAWINGS, component.kind) ? DRAWINGS[component.kind] : undefined
  const drawing = draw?.(component)
  return drawing && samePins(drawing, component.pins) ? drawing : boxDrawing(component)
}

/** The reference above the body and the value below it, centred on the body. */
function labelShapes(component: Component, body: Shape[], pins: SymbolPin[]): Shape[] {
  const { minX, maxX, minY, maxY } = boundsOf(body, pins)
  const centre = (minX + maxX) / 2
  const reference = text(component.id, pt(centre, maxY + LABEL_GAP), "center", "reference")
  if (component.value === undefined) return [reference]
  return [reference, text(component.value, pt(centre, minY - LABEL_GAP), "center", "value")]
}

/** The symbol of a component in local coordinates, rotation 0. Pin ends lie on the 0.1 grid. */
export function symbolFor(component: Component): SchSymbol {
  const drawing = drawingFor(component)
  const pins = component.pins.flatMap((pin): SymbolPin[] => {
    const placed = drawing.places[pin.number]
    return placed ? [{ number: pin.number, name: pinLabel(pin), end: placed.end, side: placed.side }] : []
  })
  const shapes = [...drawing.shapes, ...labelShapes(component, drawing.shapes, pins)]
  return { kind: component.kind, shapes, pins, bounds: boundsOf(shapes, pins) }
}
