import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { ESTIMATE_NOTE, microstrip, pairPlan, widthFor } from "./engine/impedance.js"
import { stackOf } from "./engine/rules/impedance-widths.js"
import { loadRules, RULES_PATH } from "./engine/rules/load.js"

/** What the impedance command and the guide say about what this is and is not. */
export const FAST_LINES_NOTE =
  "The router does not route pairs together and does not tune lengths: this is knowledge and checks. Route a pair by hand side by side, then read check_circuit."

const num = (n: number) => String(Math.round(n * 1000) / 1000)

function option(args: readonly string[], name: string): number | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = Number(args[index + 1])
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} needs a positive number (got "${args[index + 1] ?? ""}")`)
  return value
}

async function rulesText(root: string): Promise<Record<string, string>> {
  try {
    return { [RULES_PATH]: await readFile(join(root, RULES_PATH), "utf8") }
  } catch {
    return {}
  }
}

/** `copperflow impedance [--single 50] [--pair 90] [--gap 0.2] [--width 0.3]`: the calculation on the project's stack. */
export async function impedanceCommand(root: string, args: readonly string[]): Promise<string> {
  const { rules, diagnostics } = loadRules(await rulesText(root))
  const errors = diagnostics.filter((d) => d.severity === "error")
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join("\n"))
  const fab = rules.fabrication
  const stack = stackOf(fab)
  if ("missing" in stack) throw new Error(`the impedance cannot be calculated: ${stack.missing}`)
  const [single, pair, gap, width] = [option(args, "--single"), option(args, "--pair"), option(args, "--gap"), option(args, "--width")]
  const mask = fab.solderMask === false ? "no solder mask" : "solder mask (not counted)"
  const lines = [`Stack: ${fab.name}, ${num(stack.boardThickness)} mm board, dielectric ${num(stack.height)} mm, er ${num(stack.permittivity)}, copper ${num(stack.thickness)} mm, ${mask}`]
  const warn = (warning: string | undefined) => (warning ? [`  warning: ${warning}`] : [])
  if (single !== undefined) {
    const found = widthFor(single, stack)
    lines.push(Number.isNaN(found.width) ? `${single} ohm single: out of reach on this stack` : `${single} ohm single: ${num(found.width)} mm width`, ...warn(found.warning))
  }
  if (width !== undefined) {
    const found = microstrip({ ...stack, width })
    lines.push(`${num(width)} mm width gives ${found.impedance.toFixed(1)} ohm single`, ...warn(found.warning))
  }
  if (pair !== undefined) {
    const plan = pairPlan(pair, stack, { minGap: fab.minClearance, minWidth: fab.minTrackWidth }, gap, gap === undefined ? width : undefined)
    lines.push(plan.text, ...warn(plan.warning))
  }
  if (single === undefined && pair === undefined && width === undefined) lines.push("Give --single <ohm>, --pair <ohm> (with --gap or --width) or --width <mm>.")
  return [...lines, "", ESTIMATE_NOTE, FAST_LINES_NOTE].join("\n")
}
