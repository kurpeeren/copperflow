// A library part's `model:` in part.yaml: the kind of device, which of its pins plays which role, and each figure
// with the datasheet page it was read from. Figures are in plain units (volts, amps, ohms, watts); each has a range,
// and a kind takes only its own figures. The checklist gains one item a figure (modelChecklist).
import { z } from "zod"
import { formatQuantity } from "./values.js"

interface FigureSpec {
  unit: string
  min: number
  max: number
  what: string
}

/** Every figure a model can carry: its unit, its range and what it is. */
export const FIGURES = {
  vf: { unit: "V", min: 0.05, max: 20, what: "forward voltage at vfAt" },
  vfAt: { unit: "A", min: 1e-9, max: 100, what: "forward current of vf" },
  vf2: { unit: "V", min: 0.05, max: 20, what: "a second forward voltage, at vf2At" },
  vf2At: { unit: "A", min: 1e-9, max: 100, what: "forward current of vf2" },
  rs: { unit: "Ω", min: 0, max: 1000, what: "series resistance" },
  ifmax: { unit: "A", min: 1e-6, max: 1000, what: "largest continuous forward current" },
  pdmax: { unit: "W", min: 1e-4, max: 1000, what: "largest power" },
  vz: { unit: "V", min: 0.5, max: 1000, what: "zener voltage at vzAt" },
  vzAt: { unit: "A", min: 1e-7, max: 10, what: "zener test current" },
  zz: { unit: "Ω", min: 0.01, max: 1e5, what: "zener impedance at vzAt" },
  vth: { unit: "V", min: 0.1, max: 10, what: "gate threshold (its size, either channel)" },
  rdson: { unit: "Ω", min: 1e-4, max: 1e4, what: "on-resistance at gate voltage rdsonAt" },
  rdsonAt: { unit: "V", min: 0.5, max: 30, what: "gate voltage of rdson (its size)" },
  vsd: { unit: "V", min: 0.1, max: 5, what: "body diode forward voltage at vsdAt" },
  vsdAt: { unit: "A", min: 1e-6, max: 1000, what: "body diode current of vsd" },
  vdsmax: { unit: "V", min: 1, max: 5000, what: "largest drain to source voltage" },
  vgsmax: { unit: "V", min: 1, max: 100, what: "largest gate to source voltage" },
  idmax: { unit: "A", min: 1e-6, max: 1000, what: "largest continuous drain current" },
  hfe: { unit: "", min: 11, max: 5000, what: "current gain" },
  vbe: { unit: "V", min: 0.2, max: 1.5, what: "base to emitter voltage at vbeAt" },
  vbeAt: { unit: "A", min: 1e-7, max: 100, what: "collector current of vbe" },
  vcesat: { unit: "V", min: 0.005, max: 5, what: "saturation voltage at ic / ib = 10" },
  icmax: { unit: "A", min: 1e-6, max: 1000, what: "largest continuous collector current" },
  coil: { unit: "Ω", min: 1, max: 1e6, what: "coil resistance" },
  dcr: { unit: "Ω", min: 0, max: 1000, what: "series resistance" },
} as const satisfies Record<string, FigureSpec>

export type FigureName = keyof typeof FIGURES

interface KindSpec {
  required: readonly FigureName[]
  optional: readonly FigureName[]
  /** The pin roles a model names; the optional ones may be left out. */
  roles: readonly string[]
  optionalRoles?: readonly string[]
}

const DIODE_OPTIONAL: readonly FigureName[] = ["vf2", "vf2At", "rs", "ifmax", "pdmax"]
const DIODE_ROLES = ["anode", "cathode"]
const MOS: KindSpec = { required: ["vth", "rdson", "rdsonAt"], optional: ["vsd", "vsdAt", "vdsmax", "vgsmax", "idmax", "pdmax"], roles: ["gate", "source", "drain"] }
const BJT: KindSpec = { required: ["hfe", "vbe", "vbeAt"], optional: ["vcesat", "icmax", "pdmax"], roles: ["base", "emitter", "collector"] }
const TWO_ENDS = ["a", "b"]

export const MODEL_KINDS = {
  diode: { required: ["vf", "vfAt"], optional: DIODE_OPTIONAL, roles: DIODE_ROLES },
  led: { required: ["vf", "vfAt"], optional: DIODE_OPTIONAL, roles: DIODE_ROLES },
  schottky: { required: ["vf", "vfAt"], optional: DIODE_OPTIONAL, roles: DIODE_ROLES },
  zener: { required: ["vf", "vfAt", "vz", "vzAt"], optional: [...DIODE_OPTIONAL, "zz"], roles: DIODE_ROLES },
  nmos: MOS,
  pmos: MOS,
  npn: BJT,
  pnp: BJT,
  relay: { required: ["coil"], optional: [], roles: ["coil1", "coil2", "com"], optionalRoles: ["no", "nc"] },
  inductor: { required: [], optional: ["dcr"], roles: TWO_ENDS },
  ferrite: { required: [], optional: ["dcr"], roles: TWO_ENDS },
  fuse: { required: [], optional: [], roles: TWO_ENDS },
  chip: { required: [], optional: [], roles: [] },
} as const satisfies Record<string, KindSpec>

export type ModelKind = keyof typeof MODEL_KINDS

const KIND_NAMES = Object.keys(MODEL_KINDS) as ModelKind[]

const FigureSchema = z.object({ value: z.number(), source: z.string().min(1).max(100).regex(/^[^\x00-\x1f\x7f]*$/, "one line") }).strict()

/** The largest current a load may say a pin draws, in amps. */
const LOAD_LIMIT = 100

export const ModelSchema = z
  .object({
    kind: z.enum(KIND_NAMES),
    /** Role to pin name, e.g. { gate: "G", source: "S", drain: "D" }. */
    pins: z.record(z.string(), z.string()).optional(),
    figures: z.record(z.string(), FigureSchema).optional(),
    /** Pin name to the amps it draws at its supply, for a part that is not modelled. */
    loads: z.record(z.string(), z.number().min(0).max(LOAD_LIMIT)).optional(),
  })
  .strict()
  .superRefine((model, context) => {
    const spec: KindSpec = MODEL_KINDS[model.kind]
    const allowed = new Set<string>([...spec.required, ...spec.optional])
    const figures = model.figures ?? {}
    for (const [name, figure] of Object.entries(figures)) {
      if (!allowed.has(name)) {
        context.addIssue({ code: "custom", path: ["figures", name], message: `a ${model.kind} takes no figure ${name}; it takes ${[...allowed].join(", ") || "none"}` })
        continue
      }
      const range: FigureSpec = FIGURES[name as FigureName]
      if (figure.value < range.min || figure.value > range.max) {
        const shown = `${formatQuantity(range.min, range.unit)} to ${formatQuantity(range.max, range.unit)}`
        context.addIssue({ code: "custom", path: ["figures", name, "value"], message: `${name} (${range.what}) must be ${shown}` })
      }
    }
    for (const name of spec.required) {
      if (figures[name] === undefined) context.addIssue({ code: "custom", path: ["figures"], message: `a ${model.kind} needs figure ${name} (${FIGURES[name].what})` })
    }
    const roles = new Set<string>([...spec.roles, ...(spec.optionalRoles ?? [])])
    for (const role of Object.keys(model.pins ?? {})) {
      if (!roles.has(role)) context.addIssue({ code: "custom", path: ["pins", role], message: `a ${model.kind} has no pin role ${role}; its roles are ${[...roles].join(", ") || "none"}` })
    }
    for (const role of spec.roles) {
      if (model.pins?.[role] === undefined) context.addIssue({ code: "custom", path: ["pins"], message: `a ${model.kind} needs pins.${role}` })
    }
  })

export type Model = z.infer<typeof ModelSchema>

/** The pin names a model refers to that the part does not have. */
export function unknownModelPins(model: Model, pinNames: ReadonlySet<string>): string[] {
  return [...Object.values(model.pins ?? {}), ...Object.keys(model.loads ?? {})].filter((name) => !pinNames.has(name))
}

/** "vth 1.45 V" */
export function figureText(name: FigureName, value: number): string {
  const unit = FIGURES[name].unit
  return unit === "" ? `${name} ${Number(value.toPrecision(3))}` : `${name} ${formatQuantity(value, unit)}`
}

/** The checklist items of a model: its pins, each figure and each load, to compare with the datasheet. */
export function modelChecklist(model: Model): string[] {
  const pins = Object.entries(model.pins ?? {})
  return [
    ...(pins.length > 0 ? [`Model ${model.kind} pins: ${pins.map(([role, pin]) => `${role} ${pin}`).join(", ")}`] : []),
    ...Object.entries(model.figures ?? {}).map(([name, figure]) => `Model ${figureText(name as FigureName, figure.value)}, ${figure.source}: compare`),
    ...Object.entries(model.loads ?? {}).map(([pin, amps]) => `Load: pin ${pin} draws ${formatQuantity(amps, "A")} at its supply: compare with the datasheet's supply current`),
  ]
}
