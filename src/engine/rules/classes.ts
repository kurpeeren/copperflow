import { diagnostic } from "../diagnostics.js"
import type { Diagnostic, Net } from "../model.js"
import { DEFAULT_CLASS } from "./profiles.js"
import type { Rules } from "./schema.js"

/** A pattern with `*` (any run of characters) and `?` (one character), case-sensitive, over the whole name. */
function patternRegExp(pattern: string): RegExp {
  const body = [...pattern].map((char) => (char === "*" ? ".*" : char === "?" ? "." : char.replace(/[.+^${}()|[\]\\]/g, "\\$&"))).join("")
  return new RegExp(`^${body}$`, "s")
}

/** `*` alone matches every net, named or not; any other pattern matches the net's names. */
function matches(pattern: string, net: Net): boolean {
  if (pattern === "*") return true
  const expression = patternRegExp(pattern)
  return net.names.some((name) => expression.test(name))
}

const classesOf = (rules: Rules, net: Net): string[] =>
  rules.classes.filter((netClass) => netClass.patterns.some((pattern) => matches(pattern, net))).map((netClass) => netClass.name)

/** The class a net belongs to: the first one written that matches, or "default". */
export function classOfNet(rules: Rules, net: Net): string {
  return classesOf(rules, net)[0] ?? DEFAULT_CLASS.name
}

/**
 * The class of every net by net id, with the problems: one `net-class-conflict` error for each net
 * two classes claim (the first class written wins), and a warning for each pattern no net matches.
 */
export function netClasses(rules: Rules, nets: readonly Net[]): { byNet: Map<string, string>; diagnostics: Diagnostic[] } {
  const byNet = new Map<string, string>()
  const diagnostics: Diagnostic[] = []
  for (const net of nets) {
    const claimed = classesOf(rules, net)
    byNet.set(net.id, claimed[0] ?? DEFAULT_CLASS.name)
    if (claimed.length < 2) continue
    const message = `Net ${net.id.replace(/^net\./, "")} matches the net classes ${claimed.join(" and ")}; it uses ${claimed[0]}`
    diagnostics.push(diagnostic("net-class-conflict", "error", message, [net.id]))
  }
  return { byNet, diagnostics: [...diagnostics, ...unusedPatterns(rules, nets)] }
}

function unusedPatterns(rules: Rules, nets: readonly Net[]): Diagnostic[] {
  return rules.classes.flatMap((netClass) =>
    netClass.patterns
      .filter((pattern) => !nets.some((net) => matches(pattern, net)))
      .map((pattern) => diagnostic("rules", "warning", `Net class ${netClass.name}: the pattern "${pattern}" matches no net`, [netClass.name])),
  )
}

const clearanceOf = (rules: Rules, name: string): number => rules.classes.find((netClass) => netClass.name === name)?.clearance ?? DEFAULT_CLASS.clearance

/** The gap two classes' copper needs: the largest of their own clearances, their pair entry and the fabrication minimum. */
export function requiredClearance(rules: Rules, classA: string, classB: string): number {
  const pair = rules.classClearance
    .filter((entry) => (entry.a === classA && entry.b === classB) || (entry.a === classB && entry.b === classA))
    .map((entry) => entry.clearance)
  return Math.max(clearanceOf(rules, classA), clearanceOf(rules, classB), rules.fabrication.minClearance, ...pair)
}
