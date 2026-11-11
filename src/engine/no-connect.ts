// A part's no connect flags (Place → No connect flag, as EasyEDA's): the `noConnect` prop names the pins meant to stay
// unconnected, "pin3" or "pin3,EN", by number or by name. The electrical checks then skip pin-unconnected for them, and
// the schematic draws a cross at each pin's end. Pure: the Studio bundle imports it.
import type { Component, Pin, Point } from "./model.js"

/** The prop that holds a part's flagged pins. */
export const NO_CONNECT_PROP = "noConnect"

/** The names written in a `noConnect` value, trimmed, without empty ones or repeats. */
export function noConnectNames(value: unknown): string[] {
  if (typeof value !== "string") return []
  return [...new Set(value.split(",").map((name) => name.trim()).filter((name) => name !== ""))]
}

/** Whether `name` (pin3, or one of the pin's own names) means this pin. */
type PinNames = { number: number; names: readonly string[] }

const names = (pin: PinNames, name: string): boolean => pin.names.includes(name) || `pin${pin.number}` === name

/** The ids of the pins of a part its `noConnect` prop flags. */
export function flaggedPins(component: Pick<Component, "pins" | "props">): string[] {
  const wanted = noConnectNames(component.props[NO_CONNECT_PROP])
  return component.pins.filter((pin) => wanted.some((name) => names(pin, name))).map((pin) => pin.id)
}

/** Every flagged pin id of the circuit. */
export function flaggedPinSet(components: readonly Pick<Component, "pins" | "props">[]): ReadonlySet<string> {
  return new Set(components.flatMap(flaggedPins))
}

/** A flag on the sheet: the pin and where its end is. */
export interface NoConnectFlag {
  pin: string
  component: string
  at: Point
}

/** The flags of the placed symbols: one at the end of each flagged pin that is drawn. */
export function noConnectFlags(components: readonly Pick<Component, "id" | "pins" | "props">[], pinEnds: ReadonlyMap<string, Point>): NoConnectFlag[] {
  return components.flatMap((component) =>
    flaggedPins(component).flatMap((pin) => {
      const at = pinEnds.get(pin)
      return at ? [{ pin, component: component.id, at }] : []
    }),
  )
}

/**
 * The `noConnect` value with `pin` (written pin<n>) added, or taken away when it is there; "" when none is left.
 * Pins named by a name stay as written.
 */
export function toggleNoConnect(value: unknown, pin: PinNames): string {
  const current = noConnectNames(value)
  const has = current.some((name) => names(pin, name))
  const next = has ? current.filter((name) => !names(pin, name)) : [...current, `pin${pin.number}`]
  return next.join(",")
}
