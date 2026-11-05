import type { Component } from "../model.js"
import { arrowHead, circle, line, place, pt, rect, text, type Drawing, type Shape } from "./types.js"

const TWO_PIN = { 1: place(-0.5, 0, "left"), 2: place(0.5, 0, "right") }

export function resistor(): Drawing {
  return { shapes: [line([-0.5, 0], [-0.3, 0]), rect(-0.3, -0.08, 0.3, 0.08), line([0.3, 0], [0.5, 0])], places: TWO_PIN }
}

/** A flat plate on pin 1 and, when polarized, a curved plate on pin 2 with a + beside pin 1. */
export function capacitor(component: Component): Drawing {
  const left = [line([-0.5, 0], [-0.05, 0]), line([-0.05, -0.15], [-0.05, 0.15])]
  if (component.props["polarized"] !== true) {
    return { shapes: [...left, line([0.05, -0.15], [0.05, 0.15]), line([0.05, 0], [0.5, 0])], places: TWO_PIN }
  }
  const curved: Shape = { type: "arc", center: pt(0.25, 0), radius: 0.2, start: 150, end: 210 }
  const plus = text("+", pt(-0.2, 0.12), "center", "pin-name")
  return { shapes: [...left, curved, line([0.05, 0], [0.5, 0]), plus], places: TWO_PIN }
}

export function inductor(): Drawing {
  const bumps = [-0.225, -0.075, 0.075, 0.225].map((x): Shape => ({ type: "arc", center: pt(x, 0), radius: 0.075, start: 0, end: 180 }))
  return { shapes: [line([-0.5, 0], [-0.3, 0]), ...bumps, line([0.3, 0], [0.5, 0])], places: TWO_PIN }
}

export function fuse(): Drawing {
  const body = [rect(-0.3, -0.06, 0.3, 0.06), line([-0.3, 0], [0.3, 0])]
  return { shapes: [line([-0.5, 0], [-0.3, 0]), ...body, line([0.3, 0], [0.5, 0])], places: TWO_PIN }
}

export function crystal(): Drawing {
  const plates = [line([-0.1, -0.15], [-0.1, 0.15]), line([0.1, -0.15], [0.1, 0.15])]
  return { shapes: [line([-0.5, 0], [-0.1, 0]), ...plates, rect(-0.04, -0.15, 0.04, 0.15), line([0.1, 0], [0.5, 0])], places: TWO_PIN }
}

export function switchSymbol(): Drawing {
  const contacts = [circle(-0.3, 0, 0.03), circle(0.3, 0, 0.03)]
  return { shapes: [line([-0.5, 0], [-0.33, 0]), ...contacts, line([-0.3, 0], [0.25, 0.2]), line([0.33, 0], [0.5, 0])], places: TWO_PIN }
}

/** The long plate is the positive pin 1. */
export function battery(): Drawing {
  const plates = [line([-0.05, -0.15], [-0.05, 0.15]), line([0.05, -0.08], [0.05, 0.08])]
  const plus = text("+", pt(-0.2, 0.12), "center", "pin-name")
  return { shapes: [line([-0.5, 0], [-0.05, 0]), ...plates, line([0.05, 0], [0.5, 0]), plus], places: TWO_PIN }
}

/** The resistor body, with the wiper arrow coming down from pin 2 at the top. */
export function potentiometer(): Drawing {
  const wiper = [line([0, 0.4], [0, 0.1]), arrowHead([0, 0.4], [0, 0.08])]
  return {
    shapes: [...resistor().shapes, ...wiper],
    places: { 1: place(-0.5, 0, "left"), 2: place(0, 0.4, "top"), 3: place(0.5, 0, "right") },
  }
}

/** Pins 1 and 2 are joined on the left, 3 and 4 on the right; the plunger closes the gap between them. */
export function pushbutton(): Drawing {
  const sides = [line([-0.5, 0.2], [-0.3, 0.2], [-0.3, -0.2], [-0.5, -0.2]), line([0.5, 0.2], [0.3, 0.2], [0.3, -0.2], [0.5, -0.2])]
  const plunger = [line([-0.2, 0.1], [0.2, 0.1]), line([0, 0.1], [0, 0.3]), line([-0.1, 0.3], [0.1, 0.3])]
  return {
    shapes: [...sides, ...plunger, circle(-0.3, 0, 0.03), circle(0.3, 0, 0.03)],
    places: { 1: place(-0.5, 0.2, "left"), 2: place(-0.5, -0.2, "left"), 3: place(0.5, 0.2, "right"), 4: place(0.5, -0.2, "right") },
  }
}

export function testpoint(): Drawing {
  return { shapes: [circle(0, 0, 0.1), line([0, -0.1], [0, -0.3])], places: { 1: place(0, -0.3, "bottom") } }
}
