// What a designer must see first: each part beyond a limit. A resistor's power against its package's rating, a
// diode's or LED's current against ifmax, a part's power against pdmax, a MOSFET that is neither off nor fully on,
// a capacitor's voltage against its voltageRating.
import type { Built } from "./from-circuit.js"
import type { Solved } from "./solve.js"
import { formatQuantity } from "./values.js"

/**
 * The power ratings of thick-film chip resistors by package, from YAGEO's RC_L series datasheet (general purpose
 * chip resistors, the "Power rating at 70 °C" column): the makers' usual figures.
 */
export const RESISTOR_RATINGS: Readonly<Record<string, number>> = {
  "01005": 1 / 32,
  "0201": 1 / 20,
  "0402": 1 / 16,
  "0603": 1 / 10,
  "0805": 1 / 8,
  "1206": 1 / 4,
  "1210": 1 / 2,
  "1812": 3 / 4,
  "2010": 3 / 4,
  "2512": 1,
}
export const RESISTOR_RATINGS_SOURCE = "YAGEO RC_L thick-film chip resistors, power rating at 70 °C"

const PACKAGE = /(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)/

/** The package size in a footprint string such as "0603" or "r0805", or undefined. */
export function chipPackage(footprint: string | undefined): string | undefined {
  return footprint === undefined ? undefined : PACKAGE.exec(footprint)?.[1]
}

const V = (value: number) => formatQuantity(value, "V")
const A = (value: number) => formatQuantity(value, "A")
const W = (value: number) => formatQuantity(value, "W")

/** One line a part beyond a limit, in part order. */
export function limitLines(built: Built, solved: Solved): string[] {
  const lines: string[] = []
  for (const part of built.parts) {
    const main = solved.elements[part.main]
    if (!main) continue
    const power = part.elements.reduce((sum, index) => sum + (solved.elements[index]?.p ?? 0), 0)
    const f = part.figures
    if (part.kind === "resistor") {
      const size = chipPackage(part.footprint)
      const rating = size === undefined ? undefined : RESISTOR_RATINGS[size]
      if (rating !== undefined && power > rating) lines.push(`${part.name} takes ${W(power)}, over the ${W(rating)} rating of its ${size} package`)
    }
    if (["diode", "led", "schottky", "zener"].includes(part.kind)) {
      if (f.ifmax !== undefined && main.i > f.ifmax) lines.push(`${part.name} carries ${A(main.i)}, over its ifmax ${A(f.ifmax)}`)
    }
    if (part.kind === "nmos" || part.kind === "pmos") lines.push(...mosLines(part.name, main, f))
    if ((part.kind === "npn" || part.kind === "pnp") && f.icmax !== undefined && Math.abs(main.i) > f.icmax) lines.push(`${part.name} carries ${A(Math.abs(main.i))}, over its icmax ${A(f.icmax)}`)
    if (f.pdmax !== undefined && power > f.pdmax) lines.push(`${part.name} takes ${W(power)}, over its pdmax ${W(f.pdmax)}`)
  }
  for (const capacitor of built.capacitors) {
    if (capacitor.rating === undefined) continue
    const across = Math.abs((solved.volts[capacitor.a] ?? 0) - (solved.volts[capacitor.b] ?? 0))
    if (across > capacitor.rating) lines.push(`${capacitor.part} has ${V(across)} across it, over its voltageRating ${V(capacitor.rating)}`)
  }
  return lines
}

function mosLines(name: string, main: Solved["elements"][number], f: Built["parts"][number]["figures"]): string[] {
  const lines: string[] = []
  const vgs = main.control ?? 0
  const vth = f.vth ?? 0
  const on = f.rdsonAt ?? 0
  const off = vgs < vth
  const fullyOn = vgs >= on && main.region === "linear"
  if (!off && !fullyOn) lines.push(`${name} is neither off nor fully on: gate ${V(vgs)}, threshold ${V(vth)}, fully on from ${V(on)} (the gate voltage of its rdson)${main.region === "saturation" ? "; it limits the current" : ""}`)
  if (f.idmax !== undefined && Math.abs(main.i) > f.idmax) lines.push(`${name} carries ${A(Math.abs(main.i))}, over its idmax ${A(f.idmax)}`)
  if (f.vgsmax !== undefined && Math.abs(vgs) > f.vgsmax) lines.push(`${name} has ${V(Math.abs(vgs))} on its gate, over its vgsmax ${V(f.vgsmax)}`)
  if (f.vdsmax !== undefined && Math.abs(main.v) > f.vdsmax) lines.push(`${name} has ${V(Math.abs(main.v))} drain to source, over its vdsmax ${V(f.vdsmax)}`)
  return lines
}
