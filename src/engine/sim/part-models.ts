// Where each part's figures come from: a library part's `model:` in part.yaml, or a built-in part's props (vf,
// vfAt, vth, rdson, …, read as values such as "2.65V" or "2mA"). A built-in diode or LED with no figures takes the
// generic ones below and every figure resting on them is marked assumed; a transistor or MOSFET is never guessed.
import type { Component } from "../model.js"
import { FIGURES, type FigureName, type Model, type ModelKind } from "./model-schema.js"
import { parseQuantity } from "./values.js"

/** The figures of one part, by name, and the ones that were not given but assumed. */
export interface PartFigures {
  kind: ModelKind
  figures: Partial<Record<FigureName, number>>
  assumed: string[]
  /** Role to pin name, when a library model names them. */
  pins: Record<string, string>
  loads: Record<string, number>
}

/** Generic forward points for a diode, LED or Schottky that gives none, and the emission coefficient of a one-point fit. */
export const GENERIC = {
  diode: { vf: 0.7, vfAt: 1e-3, n: 2 },
  led: { vf: 2.0, vfAt: 10e-3, n: 2 },
  schottky: { vf: 0.35, vfAt: 1e-3, n: 1.1 },
  zener: { vf: 0.7, vfAt: 1e-3, n: 2 },
  /** A MOSFET body diode with no vsd. */
  body: { vf: 0.8, vfAt: 1, n: 1.5 },
} as const

/** The figures a built-in kind reads from its props. */
const PROP_FIGURES: Readonly<Record<string, readonly FigureName[]>> = {
  diode: ["vf", "vfAt", "vf2", "vf2At", "rs", "ifmax", "pdmax", "vz", "vzAt", "zz"],
  led: ["vf", "vfAt", "vf2", "vf2At", "rs", "ifmax", "pdmax"],
  mosfet: ["vth", "rdson", "rdsonAt", "vsd", "vsdAt", "vdsmax", "vgsmax", "idmax", "pdmax"],
  transistor: ["hfe", "vbe", "vbeAt", "vcesat", "icmax", "pdmax"],
  inductor: ["dcr"],
}

/** What a built-in kind is as a model kind; undefined for what is not modelled from props. */
function builtInKind(component: Component): ModelKind | undefined {
  const props = component.props
  switch (component.kind) {
    case "diode":
      if (props["zener"] === true || props["vz"] !== undefined) return "zener"
      return props["schottky"] === true ? "schottky" : "diode"
    case "led":
      return "led"
    case "mosfet":
      return props["channelType"] === "p" ? "pmos" : "nmos"
    case "transistor":
      return props["type"] === "pnp" ? "pnp" : "npn"
    case "inductor":
      return "inductor"
    default:
      return undefined
  }
}

/** The props a part writes as figures; a prop that is not a value is an error naming it. */
function propFigures(component: Component): { figures: Partial<Record<FigureName, number>>; errors: string[] } {
  const figures: Partial<Record<FigureName, number>> = {}
  const errors: string[] = []
  for (const name of PROP_FIGURES[component.kind] ?? []) {
    const written = component.props[name]
    if (written === undefined) continue
    const value = parseQuantity(written)
    const range = FIGURES[name]
    const size = value === undefined ? undefined : Math.abs(value)
    if (size === undefined || size < range.min || size > range.max) errors.push(`${component.id}: ${name} must be a value such as "${range.unit === "A" ? "2mA" : range.unit === "Ω" ? "48mohm" : "2.5V"}" (${range.what})`)
    else figures[name] = size
  }
  return { figures, errors }
}

/** What to set on a transistor or MOSFET that has no figures. */
function refusalFor(component: Component, kind: ModelKind, missing: readonly string[]): string {
  const library = component.library === undefined ? `set the props ${missing.join(", ")}` : `add model: to parts/${component.library}/part.yaml`
  return `${component.id} (${kind}) has no ${missing.join(", ")}: ${library} from its datasheet; a transistor or MOSFET is not guessed`
}

const DIODE_KINDS: readonly ModelKind[] = ["diode", "led", "schottky", "zener"]

/** The figures of a built-in part, with the generic ones a diode or LED lacks, or a refusal. */
function builtInFigures(component: Component, kind: ModelKind): PartFigures | { refusal: string } {
  const { figures, errors } = propFigures(component)
  if (errors.length > 0) return { refusal: errors.join("; ") }
  const assumed: string[] = []
  if (DIODE_KINDS.includes(kind) && (figures.vf === undefined || figures.vfAt === undefined)) {
    const generic = GENERIC[kind as keyof typeof GENERIC]
    figures.vf = generic.vf
    figures.vfAt = generic.vfAt
    assumed.push(`vf ${generic.vf} V at ${generic.vfAt * 1000} mA`)
  }
  if (kind === "zener" && (figures.vz === undefined || figures.vzAt === undefined)) return { refusal: refusalFor(component, kind, ["vz", "vzAt"]) }
  const required: Partial<Record<ModelKind, readonly FigureName[]>> = { nmos: ["vth", "rdson", "rdsonAt"], pmos: ["vth", "rdson", "rdsonAt"], npn: ["hfe", "vbe", "vbeAt"], pnp: ["hfe", "vbe", "vbeAt"] }
  const missing = (required[kind] ?? []).filter((name) => figures[name] === undefined)
  if (missing.length > 0) return { refusal: refusalFor(component, kind, missing) }
  return { kind, figures, assumed, pins: {}, loads: {} }
}

/** The figures of a library part's model. */
function libraryFigures(model: Model): PartFigures {
  const figures = Object.fromEntries(Object.entries(model.figures ?? {}).map(([name, figure]) => [name, figure.value])) as Partial<Record<FigureName, number>>
  return { kind: model.kind, figures, assumed: [], pins: { ...(model.pins ?? {}) }, loads: { ...(model.loads ?? {}) } }
}

/**
 * A part's figures: from its library model, else its props when its kind is modelled from props; undefined when it
 * is not modelled at all (a chip, a connector, a module's unknown part).
 */
export function partFigures(component: Component, models: ReadonlyMap<string, Model>): PartFigures | { refusal: string } | undefined {
  const model = component.library === undefined ? undefined : models.get(component.library)
  if (model) return libraryFigures(model)
  if (component.library !== undefined) return undefined
  const kind = builtInKind(component)
  return kind === undefined ? undefined : builtInFigures(component, kind)
}
