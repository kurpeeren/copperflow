// Draws a glyph of the icon set (icon-shapes.ts) as a 16px SVG element: one look for every icon in the Studio.
import { createElement, type ReactElement, type SVGProps } from "react"
import { ICONS, type IconName, type Shape } from "./icon-shapes.js"

export type IconProps = SVGProps<SVGSVGElement>

/** What every icon's <svg> carries: the 16-unit grid at 16px, 1.5px round strokes in the text colour. */
const SVG_ATTRS = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  shapeRendering: "geometricPrecision",
  "aria-hidden": true,
} as const

/** A shape's attributes: a filled one fills in the text colour with no stroke; a dashed one gets its dash. */
function shapeAttrs(shape: Shape, key: number): Record<string, unknown> {
  const { tag: _tag, fill, dash, ...geometry } = shape as Shape & { fill?: true; dash?: string }
  return { key, ...geometry, ...(fill ? { fill: "currentColor", stroke: "none" } : {}), ...(dash ? { strokeDasharray: dash } : {}) }
}

/** The icon `name` as an <svg>; props (a class name, a title) go on the svg. */
export function iconSvg(name: IconName, props: IconProps = {}): ReactElement {
  const shapes: readonly Shape[] = ICONS[name]
  return createElement("svg", { ...SVG_ATTRS, ...props }, ...shapes.map((shape, i) => createElement(shape.tag, shapeAttrs(shape, i))))
}
