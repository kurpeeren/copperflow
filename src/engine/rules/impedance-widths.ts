import { diagnostic } from "../diagnostics.js"
import { pairPlan, widthFor, type Stack } from "../impedance.js"
import type { Diagnostic } from "../model.js"
import type { FabricationProfile, NetClass, Rules } from "./schema.js"

const round3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * The stack an impedance is calculated on, or the sentence that says which value to set. On 2 layers the dielectric
 * is the board minus its two coppers unless `dielectricHeight` is set; on 4 layers only `dielectricHeight` will do.
 */
export function stackOf(fabrication: FabricationProfile): (Stack & { boardThickness: number }) | { missing: string } {
  const { permittivity, copperThickness, boardThickness, dielectricHeight, copperLayers, name } = fabrication
  const missing = (key: string) => ({ missing: `the profile ${name} gives no ${key}; set fabrication.${key} in rules.yaml` })
  if (permittivity === undefined) return missing("permittivity")
  if (copperThickness === undefined) return missing("copperThickness")
  if (boardThickness === undefined) return missing("boardThickness")
  if (dielectricHeight === undefined && copperLayers !== 2) return missing("dielectricHeight")
  const height = dielectricHeight ?? boardThickness - 2 * copperThickness
  return { height, permittivity, thickness: copperThickness, boardThickness }
}

/**
 * Fills trackWidth (and a pair's gap) of each class that gives an impedance and no trackWidth, from the stack. A class
 * that cannot be calculated keeps its width and gets a `rules` warning that says why.
 */
export function deriveWidths(rules: Rules, widthWritten: ReadonlySet<string>): { rules: Rules; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const classes = rules.classes.map((netClass) => {
    if (widthWritten.has(netClass.name) || (netClass.impedance === undefined && netClass.differentialImpedance === undefined)) return netClass
    const derived = derive(netClass, rules.fabrication)
    if ("warning" in derived) {
      const message = `Net class ${netClass.name}: the impedance cannot be calculated: ${derived.warning} (and trackWidth uses ${netClass.trackWidth} mm)`
      diagnostics.push(diagnostic("rules", "warning", message, [netClass.name]))
      return netClass
    }
    return { ...netClass, ...derived }
  })
  return { rules: { ...rules, classes }, diagnostics }
}

function derive(netClass: NetClass, fabrication: FabricationProfile): Partial<NetClass> | { warning: string } {
  const stack = stackOf(fabrication)
  if ("missing" in stack) return { warning: stack.missing }
  if (netClass.differentialImpedance !== undefined) {
    const plan = pairPlan(netClass.differentialImpedance, stack, { minGap: fabrication.minClearance, minWidth: fabrication.minTrackWidth }, netClass.gap)
    if (!plan.practical) return { warning: plan.text }
    const gap = round3(plan.gap)
    return { trackWidth: round3(plan.width), gap, widthFrom: `${netClass.differentialImpedance} ohm differential at a ${gap} mm gap` }
  }
  const found = widthFor(netClass.impedance as number, stack)
  if (Number.isNaN(found.width) || found.width < fabrication.minTrackWidth) return { warning: `${netClass.impedance} ohm needs a width under the profile's smallest track` }
  return { trackWidth: round3(found.width), widthFrom: `${netClass.impedance} ohm single` }
}
