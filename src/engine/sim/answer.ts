// The simulator's answer: at most 40 lines. The nets, the sources and the power drawn, then what a designer needs to
// see first (parts beyond a limit), then each part's voltage, current and power, largest power first, cut at the
// limit with the count left out. Also the figures a case can expect, by name.
import { naturalCompare } from "../order.js"
import type { Built } from "./from-circuit.js"
import { limitLines } from "./limits.js"
import type { NotConverged, Solved } from "./solve.js"
import { formatQuantity } from "./values.js"

export const ANSWER_LINES = 40
const WIDTH = 110

/** The one line a person or agent reads first: what this is and what it does not know. */
export const HONEST_LINE = "DC operating point from ideal sources and simple models: no time, no frequency, no temperature, no tolerance; chips are not modelled."

const V = (value: number) => formatQuantity(value, "V")
const A = (value: number) => formatQuantity(value, "A")
const W = (value: number) => formatQuantity(value, "W")

/** Items after a prefix, wrapped into lines of about WIDTH characters. */
function wrapped(prefix: string, items: readonly string[], separator = ", "): string[] {
  const lines: string[] = []
  let line = prefix
  for (const item of items) {
    const joined = line === prefix ? `${line}${item}` : `${line}${separator}${item}`
    if (joined.length > WIDTH && line !== prefix) {
      lines.push(`${line}${separator.trimEnd()}`)
      line = `  ${item}`
    } else line = joined
  }
  lines.push(line)
  return lines
}

/** Every net name's voltage (NaN when floating) and each part's figures: R1.i, R1.v, R1.p, Q1.vgs, K1.coil.i. */
export function figureValues(built: Built, solved: Solved): Map<string, number> {
  const values = new Map<string, number>()
  for (const [name, node] of built.netNodes) values.set(name, built.floating.has(node) ? Number.NaN : (solved.volts[node] ?? 0))
  for (const part of built.parts) {
    const main = solved.elements[part.main]
    if (!main) continue
    const power = part.elements.reduce((sum, index) => sum + (solved.elements[index]?.p ?? 0), 0)
    const stem = part.kind === "relay" ? `${part.name}.coil` : part.name
    values.set(`${stem}.v`, main.v)
    values.set(`${stem}.i`, main.i)
    values.set(`${stem}.p`, power)
    if (part.kind === "relay") for (const key of ["v", "i", "p"]) values.set(`${part.name}.${key}`, values.get(`${stem}.${key}`) ?? 0)
    if (main.control !== undefined) values.set(`${part.name}.${part.kind === "nmos" || part.kind === "pmos" ? "vgs" : "vbe"}`, main.control)
  }
  return values
}

/** A MOSFET as a designer reads a switch: off, on (with its Vds), or between off and on. */
function switchState(main: Solved["elements"][number], f: Built["parts"][number]["figures"]): string {
  const vgs = main.control ?? 0
  if (vgs < (f.vth ?? 0)) return "off"
  if (vgs >= (f.rdsonAt ?? Number.POSITIVE_INFINITY) && main.region === "linear") return `on (Vds ${V(Math.abs(main.v))})`
  return "between off and on"
}

function partLine(solved: Solved, part: Built["parts"][number]): { power: number; line: string } {
  const main = solved.elements[part.main]
  const power = part.elements.reduce((sum, index) => sum + (solved.elements[index]?.p ?? 0), 0)
  const what = part.kind === "relay" ? "relay coil" : part.kind
  const extra = main?.control === undefined ? "" : part.kind === "nmos" || part.kind === "pmos" ? `, gate ${V(main.control)}, ${switchState(main, part.figures)}` : `, base ${V(main.control)}`
  return { power, line: `  ${part.name} ${what} ${V(main?.v ?? 0)} ${A(main?.i ?? 0)} ${W(power)}${extra}` }
}

/** The answer for a solved circuit. `all` shows the nets that have no name too. */
export function formatAnswer(built: Built, solved: Solved, options: { all?: boolean } = {}): string {
  const shown = new Map<number, string>()
  for (const [name, node] of [...built.netNodes].sort(([a], [b]) => naturalCompare(a, b))) {
    const named = !name.startsWith("net.") && !name.startsWith("net:")
    if ((named || options.all) && !shown.has(node)) shown.set(node, name.replace(/^net[.:]/, ""))
  }
  const nets = [...shown].map(([node, name]) => `${name} ${built.floating.has(node) ? "floating" : V(solved.volts[node] ?? 0)}`)
  const drawn = solved.sources.reduce((sum, source) => sum + source.volts * source.amps, 0)
  const sources = solved.sources.map((source) => `${source.name} gives ${A(source.amps)} (${W(source.volts * source.amps)})`)
  const limits = limitLines(built, solved)
  const unmodelled = built.unmodelled.map((u) => (u.power.length === 0 ? u.part : `${u.part} (${u.power.map((p) => `${p.pin} ${built.floating.has(p.node) ? "floating" : V(solved.volts[p.node] ?? 0)}`).join(", ")})`))
  const assumed = built.parts.filter((part) => part.assumed.length > 0).map((part) => `${part.name} ${part.assumed.join(", ")}`)
  const head = [
    HONEST_LINE,
    ...wrapped("Nets: ", nets),
    ...wrapped("Sources: ", [...sources, `total drawn ${W(drawn)}`]),
    ...(limits.length === 0 ? ["Beyond a limit: none"] : ["Beyond a limit:", ...limits.map((line) => `  ${line}`)]),
  ]
  const tail = [...(unmodelled.length > 0 ? wrapped("Not modelled, their pins draw nothing: ", unmodelled, "; ") : []), ...(assumed.length > 0 ? wrapped("Assumed, not from a datasheet: ", assumed, "; ") : [])]
  const parts = built.parts.map((part) => partLine(solved, part)).sort((a, b) => b.power - a.power)
  const room = ANSWER_LINES - head.length - tail.length - 1
  const kept = parts.length <= room ? parts : parts.slice(0, Math.max(0, room - 1))
  const left = parts.length - kept.length
  const body = parts.length === 0 ? [] : ["Parts, largest power first:", ...kept.map((part) => part.line), ...(left > 0 ? [`  … ${left} more part${left === 1 ? "" : "s"}`] : [])]
  return [...head, ...body, ...tail].slice(0, ANSWER_LINES).join("\n")
}

/** The answer when Newton's method and source stepping both failed: the nodes that moved most, and no figures. */
export function formatNotConverged(result: NotConverged): string {
  const moved = result.moved.map((m) => `${m.node} by ${V(Math.abs(m.delta))}`).join(", ")
  return [HONEST_LINE, `Did not converge, even with the sources raised in steps; the nodes that moved most in the last step: ${moved}. No figures are given.`].join("\n")
}
