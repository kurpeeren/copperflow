import type { Component } from "../model.js"
import { arrowHead, line, place, polygon, type Drawing, type Shape } from "./types.js"

type Pt = [number, number]

/** The cathode bar of a diode: straight, or bent at the ends for the zener, TVS and Schottky variants. */
const BARS: Readonly<Record<string, Pt[]>> = {
  plain: [[0.15, -0.15], [0.15, 0.15]],
  zener: [[0.1, -0.1], [0.15, -0.15], [0.15, 0.15], [0.2, 0.1]],
  tvs: [[0.2, -0.1], [0.15, -0.15], [0.15, 0.15], [0.2, 0.1]],
  schottky: [[0.1, -0.1], [0.1, -0.15], [0.2, -0.15], [0.2, 0.15], [0.1, 0.15], [0.1, 0.1]],
}

const TWO_PIN = { 1: place(-0.5, 0, "left"), 2: place(0.5, 0, "right") }

/** Pin 1 is the anode on the left; the bar is on the cathode, pin 2. */
export function diode(component: Component): Drawing {
  const variant = component.props["variant"]
  const bar = BARS[typeof variant === "string" && variant in BARS ? variant : "plain"] ?? []
  const shapes: Shape[] = [
    line([-0.5, 0], [-0.15, 0]),
    polygon([[-0.15, 0.15], [-0.15, -0.15], [0.15, 0]], true),
    line(...bar),
    line([0.15, 0], [0.5, 0]),
  ]
  return { shapes, places: TWO_PIN }
}

/** A diode with two arrows leaving it. */
export function led(component: Component): Drawing {
  const light = [[-0.05, 0.2, 0.05, 0.3], [0.05, 0.2, 0.15, 0.3]] as const
  const arrows = light.flatMap(([x1, y1, x2, y2]): Shape[] => [line([x1, y1], [x2, y2]), arrowHead([x1, y1], [x2, y2])])
  return { shapes: [...diode(component).shapes, ...arrows], places: TWO_PIN }
}

const BASE_PLACES = { 1: place(-0.5, 0, "left"), 2: place(0.3, -0.5, "bottom"), 3: place(0.3, 0.5, "top") }

/** The emitter arrow points away from the base for NPN and toward it for PNP. */
export function transistor(component: Component): Drawing {
  const outward = component.props["type"] !== "pnp"
  const along: [Pt, Pt] = outward ? [[0.1, -0.2], [0.2, -0.25]] : [[0.12, -0.21], [0.02, -0.16]]
  return {
    shapes: [
      line([-0.5, 0], [-0.1, 0]),
      line([-0.1, -0.25], [-0.1, 0.25]),
      line([-0.1, 0.1], [0.3, 0.3], [0.3, 0.5]),
      line([-0.1, -0.1], [0.3, -0.3], [0.3, -0.5]),
      arrowHead(along[0], along[1], 0.1, 0.05),
    ],
    places: BASE_PLACES,
  }
}

/** The arrow on the body line points at the channel for an N-channel part and away from it for a P-channel part. */
export function mosfet(component: Component): Drawing {
  const toward = component.props["channelType"] !== "p"
  const arrow: [Pt, Pt] = toward ? [[0.1, 0], [-0.1, 0]] : [[-0.1, 0], [0.1, 0]]
  const channel = [line([-0.1, 0.2], [-0.1, 0.1]), line([-0.1, 0.05], [-0.1, -0.05]), line([-0.1, -0.1], [-0.1, -0.2])]
  return {
    shapes: [
      line([-0.5, 0], [-0.2, 0]),
      line([-0.2, -0.2], [-0.2, 0.2]),
      ...channel,
      line([-0.1, 0.15], [0.3, 0.15], [0.3, 0.5]),
      line([-0.1, -0.15], [0.3, -0.15], [0.3, -0.5]),
      line([-0.1, 0], [0.3, 0], [0.3, -0.15]),
      arrowHead(arrow[0], arrow[1], 0.1, 0.05),
    ],
    places: BASE_PLACES,
  }
}
