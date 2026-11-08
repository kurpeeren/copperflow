import { LineCounter, isNode, parseDocument, visit, type Document } from "yaml"
import { diagnostic } from "../diagnostics.js"
import type { Board, Diagnostic } from "../model.js"
import { DEFAULT_CLASS, DEFAULT_PROFILE, PROFILES } from "./profiles.js"
import { RulesFileSchema, type FabricationProfile, type NetClass, type Rules, type RulesFile } from "./schema.js"

/** The project file that holds the rules, at the project root. */
export const RULES_PATH = "rules.yaml"

/** Where a problem is in the file: a path of keys and indexes. */
interface Problem {
  message: string
  path: readonly (string | number)[]
}

const OVERRIDABLE = ["minTrackWidth", "minClearance", "minDrill", "minAnnularRing", "boardEdgeClearance", "minHoleToHole", "minSilkToPad"] as const

const defaultProfile = (): FabricationProfile => PROFILES[DEFAULT_PROFILE] as FabricationProfile

const defaultRules = (file?: string): Rules => ({
  fabrication: defaultProfile(),
  classes: [],
  classClearance: [],
  globalNets: [],
  ...(file === undefined ? {} : { file }),
})

/**
 * Reads rules.yaml from the project files. A missing file gives the default rules; a file with
 * any problem gives the default rules and one `rules` error per problem, with file and line.
 */
export function loadRules(files: Readonly<Record<string, string>>): { rules: Rules; diagnostics: Diagnostic[] } {
  const text = files[RULES_PATH]
  if (text === undefined) return { rules: defaultRules(), diagnostics: [] }
  const lines = new LineCounter()
  const document = parseDocument(text, { lineCounter: lines })
  const syntax = document.errors[0]
  if (syntax) {
    const line = syntax.linePos?.[0]
    const problem: Problem = { message: syntax.message.split("\n")[0] ?? "not valid YAML", path: [] }
    return failed([report(problem, line ? { line: line.line, column: line.col, offset: syntax.pos[0] } : undefined)])
  }
  try {
    return readDocument(document, lines)
  } catch (error) {
    return failed([unreadable(error, document, lines)])
  }
}

function readDocument(document: Document, lines: LineCounter): { rules: Rules; diagnostics: Diagnostic[] } {
  const locate = locator(document, lines)
  const parsed = RulesFileSchema.safeParse(document.toJS() ?? {})
  const resolved = parsed.success ? resolve(parsed.data) : undefined
  const problems = resolved ? resolved.problems : schemaProblems(parsed.error?.issues ?? [])
  if (!resolved || problems.length > 0) return failed(problems.map((problem) => report(problem, locate(problem.path))))
  return { rules: resolved.rules, diagnostics: [] }
}

const failed = (diagnostics: Diagnostic[]) => ({ rules: defaultRules(RULES_PATH), diagnostics })

type Place = { line: number; column: number; offset: number } | undefined

/**
 * A file that parses but cannot be read, such as `nets: [*GND]`, where YAML takes `*GND` for an
 * alias of an anchor that does not exist, or aliases that expand without end. Located at the first alias.
 */
function unreadable(error: unknown, document: Document, lines: LineCounter): Diagnostic {
  const place = firstAlias(document, lines)
  const text = (error instanceof Error ? error.message : String(error)).split("\n")[0] || "the file cannot be read"
  const hint = place ? `; a pattern that starts with * must be in quotes, such as "*GND"` : ""
  return report({ message: `${text}${hint}`, path: [] }, place)
}

function firstAlias(document: Document, lines: LineCounter): Place {
  let offset: number | undefined
  visit(document, {
    Alias(_, node) {
      offset = node.range?.[0]
      return visit.BREAK
    },
  })
  if (offset === undefined) return undefined
  const { line, col } = lines.linePos(offset)
  return { line, column: col, offset }
}

function report(problem: Problem, place: Place): Diagnostic {
  const where = place ? `${RULES_PATH}:${place.line}` : RULES_PATH
  const label = problem.path.length > 0 ? `${problem.path.join(".")}: ` : ""
  const source = place ? { file: RULES_PATH, ...place } : undefined
  return diagnostic("rules", "error", `${where}: ${label}${problem.message}`, [RULES_PATH], source)
}

/** Finds a path's line in the document, or the nearest parent that exists. */
function locator(document: Document, lines: LineCounter): (path: Problem["path"]) => Place {
  return (path) => {
    for (let length = path.length; length >= 0; length -= 1) {
      const node = length === 0 ? document.contents : document.getIn(path.slice(0, length), true)
      const offset = isNode(node) ? node.range?.[0] : undefined
      if (offset === undefined) continue
      const { line, col } = lines.linePos(offset)
      return { line, column: col, offset }
    }
    return undefined
  }
}

function schemaProblems(issues: readonly { code: string; message: string; path: PropertyKey[]; keys?: string[] }[]): Problem[] {
  return issues.flatMap((issue) => {
    const path = issue.path.filter((part): part is string | number => typeof part !== "symbol")
    if (issue.code !== "unrecognized_keys") return [{ message: issue.message, path }]
    return (issue.keys ?? []).map((key) => ({ message: `Unrecognized key: "${key}"`, path: [...path, key] }))
  })
}

/** Fills in profile and defaults. Problems here are the ones the schema cannot see: names that point nowhere. */
function resolve(file: RulesFile): { rules: Rules; problems: Problem[] } {
  const problems: Problem[] = []
  const profileName = file.fabrication?.profile ?? DEFAULT_PROFILE
  const profile = PROFILES[profileName]
  if (!profile) {
    problems.push({ message: `unknown profile "${profileName}"; use one of ${Object.keys(PROFILES).join(", ")}`, path: ["fabrication", "profile"] })
  }
  const classes = Object.entries(file.netClasses ?? {}).map(([name, written]) => resolveClass(name, written, problems))
  const known = new Set(["default", ...classes.map((netClass) => netClass.name)])
  const classClearance = (file.classClearance ?? []).flatMap(([a, b, clearance], index) => {
    const unknown = [a, b].filter((name) => !known.has(name))
    for (const name of unknown) problems.push({ message: `unknown net class "${name}"`, path: ["classClearance", index, name === a ? 0 : 1] })
    return unknown.length > 0 ? [] : [{ a, b, clearance }]
  })
  const fabrication = { ...(profile ?? defaultProfile()), ...overrides(file.fabrication) }
  return { rules: { fabrication, classes, classClearance, globalNets: file.globalNets ?? [], file: RULES_PATH }, problems }
}

function overrides(fabrication: RulesFile["fabrication"]): Partial<FabricationProfile> {
  const entries = OVERRIDABLE.flatMap((field) => {
    const value = fabrication?.[field]
    return value === undefined ? [] : [[field, value] as const]
  })
  return Object.fromEntries(entries)
}

function resolveClass(name: string, written: NonNullable<RulesFile["netClasses"]>[string], problems: Problem[]): NetClass {
  if (name === DEFAULT_CLASS.name) {
    problems.push({ message: `"${name}" is the class of every other net and cannot be defined`, path: ["netClasses", name] })
  }
  return {
    name,
    trackWidth: written.trackWidth ?? DEFAULT_CLASS.trackWidth,
    clearance: written.clearance ?? DEFAULT_CLASS.clearance,
    via: { drill: written.via?.drill ?? DEFAULT_CLASS.via.drill, diameter: written.via?.diameter ?? DEFAULT_CLASS.via.diameter },
    patterns: written.nets,
  }
}

/** A `rules` warning when the fabrication profile is for another number of copper layers than the board has. */
export function layerCountWarnings(rules: Rules, board: Board | undefined): Diagnostic[] {
  const { name, copperLayers } = rules.fabrication
  if (board === undefined || board.layers === copperLayers) return []
  const message = `The fabrication profile ${name} is for ${copperLayers} copper layers, but the board has ${board.layers}; choose a matching profile in ${RULES_PATH}`
  return [diagnostic("rules", "warning", message, [RULES_PATH])]
}
