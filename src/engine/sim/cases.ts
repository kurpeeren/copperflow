// A sheet's cases: named sets of sources with the ranges the module's figures must fall in. Written on the sheet's
// card (`<sheet cases={[…]}>`) as plain literals, run by simulate, one line each. Passing cases is not a person's
// verification of the module and is never shown as one.
import { z } from "zod"
import type { Circuit } from "../model.js"
import type { Model } from "./model-schema.js"
import { simulateCircuit } from "./run.js"
import { formatQuantity } from "./values.js"

/** The most cases one sheet holds. */
export const CASE_LIMIT = 12

const Range = z.tuple([z.number(), z.number()]).refine(([low, high]) => low <= high, "a range is [low, high] with low <= high")

export const CaseSchema = z
  .object({
    name: z.string().min(1).max(60).regex(/^[^\r\n]*$/, "one line"),
    set: z.record(z.string(), z.union([z.number(), z.literal("open")])),
    closed: z.array(z.string()).optional(),
    coil: z.array(z.string()).optional(),
    /** Net name or part figure (R1.i, R1.v, R1.p, Q1.vgs, K1.coil.i) to its [low, high] range. */
    expect: z.record(z.string(), Range),
  })
  .strict()

export type SimCase = z.infer<typeof CaseSchema>

export const CasesSchema = z.array(CaseSchema).max(CASE_LIMIT)

/** The unit of a figure by its name: amps for .i, watts for .p, volts for the rest. */
function unitOf(figure: string): string {
  if (figure.endsWith(".i")) return "A"
  if (figure.endsWith(".p")) return "W"
  return "V"
}

export interface CaseLine {
  name: string
  passed: boolean
  text: string
}

/** What a figure missed by, or undefined when it is in its range. */
function missOf(figure: string, [low, high]: readonly [number, number], value: number | undefined): string | undefined {
  if (value === undefined) return `${figure} is no net or figure of this circuit`
  const unit = unitOf(figure)
  const wanted = `wanted ${formatQuantity(low, unit)} to ${formatQuantity(high, unit)}`
  if (Number.isNaN(value)) return `${figure} is floating, ${wanted}`
  return value < low || value > high ? `${figure} ${formatQuantity(value, unit)}, ${wanted}` : undefined
}

/** Runs each case on the circuit: "passed: <name>", or each figure that missed and its range. */
export function runCases(circuit: Circuit, models: ReadonlyMap<string, Model>, cases: readonly SimCase[]): CaseLine[] {
  return cases.map((one) => {
    const run = simulateCircuit(circuit, models, { set: one.set, ...(one.closed ? { closed: one.closed } : {}), ...(one.coil ? { coil: one.coil } : {}) })
    if (!run.ok) {
      const why = run.text.split("\n").slice(1).join(" ").replace(/\s+/g, " ").trim()
      return { name: one.name, passed: false, text: `NOT RUN: ${one.name}: ${why}` }
    }
    const misses = Object.entries(one.expect).flatMap(([figure, range]) => {
      const missed = missOf(figure, range, run.figures.get(figure))
      return missed === undefined ? [] : [missed]
    })
    if (misses.length > 0) return { name: one.name, passed: false, text: `MISSED: ${one.name}: ${misses.join("; ")}` }
    return { name: one.name, passed: true, text: `passed: ${one.name}` }
  })
}

/** `"24 V in": IN=24, GND=0; expects OUT 3.2 to 3.6` */
export function caseText(one: SimCase): string {
  const set = Object.entries(one.set).map(([net, volts]) => `${net}=${volts}`)
  const switches = [...(one.closed ?? []).map((name) => `${name} closed`), ...(one.coil ?? []).map((name) => `${name} energised`)]
  const expects = Object.entries(one.expect).map(([figure, [low, high]]) => `${figure} ${low} to ${high}`)
  return `"${one.name}": ${[...set, ...switches].join(", ")}; expects ${expects.join(", ")}`
}
