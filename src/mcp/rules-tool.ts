// set_rules: a partial rules object merged into rules.yaml as one history entry (core/rules-patch.ts), answered with
// what changed and what the rules now mean for the board: each class's nets and track width, the tracks narrower
// than their class asks, and a fabrication profile for another layer count than the board has. project_status shows
// the rules in force in one "Rules:" line (rulesLine).
import { z } from "zod"
import { listCircuits, resolveCircuit } from "../core/index.js"
import { readIfThere } from "../core/file-writes.js"
import { setRules } from "../core/rules-patch.js"
import type { Design } from "../engine/design.js"
import { netClasses } from "../engine/rules/classes.js"
import { loadRules, RULES_PATH } from "../engine/rules/load.js"
import { DEFAULT_CLASS } from "../engine/rules/profiles.js"
import type { Rules } from "../engine/rules/schema.js"
import { resolve } from "node:path"
import { buildOf, type Ports } from "./copper-tools.js"

export const setRulesInput = {
  rules: z.record(z.string(), z.unknown()).describe('e.g. { "netClasses": { "power": { "nets": ["GND"], "trackWidth": 0.5 } } }; null removes'),
  file: z.string().optional().describe("Circuit to report on"),
}

export const SET_RULES_DESCRIPTION =
  'Change rules.yaml as ONE change, merged into it: netClasses (trackWidth, clearance, via), fabrication (profile "jlcpcb-4layer", minimums, placementRotations). A bad value is refused with the reason. The answer says what it means for the board.'

const mm = (v: number) => String(Math.round(v * 1000) / 1000)
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`
const netName = (id: string) => id.replace(/^net\./, "")

/** "Rules: jlcpcb-2layer (2 layers); default tracks 0.25 mm, clearance 0.2 mm; class power 0.5/0.2 mm: GND, V5" */
export function formatRules(rules: Rules): string {
  const { name, copperLayers } = rules.fabrication
  const classes = rules.classes.map((one) => `class ${one.name} ${mm(one.trackWidth)}/${mm(one.clearance)} mm: ${one.patterns.join(", ")}`)
  return [`Rules: ${name} (${copperLayers} layers)`, `default tracks ${mm(DEFAULT_CLASS.trackWidth)} mm, clearance ${mm(DEFAULT_CLASS.clearance)} mm`, ...classes].join("; ")
}

/** The project_status line: the rules in force, or the problems that put the defaults in force. */
export async function rulesLine(root: string): Promise<string> {
  const text = await readIfThere(resolve(root, RULES_PATH))
  const { rules, diagnostics } = loadRules(text === undefined ? {} : { [RULES_PATH]: text })
  const errors = diagnostics.filter((d) => d.severity === "error")
  const line = formatRules(rules)
  return errors.length === 0 ? line : `${line} (defaults: ${RULES_PATH} has ${plural(errors.length, "error")}: ${errors[0]?.message})`
}

/** What the rules mean for a built board: each class's nets, tracks narrower than their class, a layer mismatch. */
export function effectLines(design: Design): string[] {
  const { byNet } = netClasses(design.rules, design.circuit.nets)
  const lines = design.rules.classes.flatMap((one) => {
    const nets = design.circuit.nets.filter((net) => byNet.get(net.id) === one.name).map((net) => netName(net.id))
    const narrow = design.pcb.tracks.filter((track) => track.net !== undefined && byNet.get(track.net) === one.name && track.width < one.trackWidth - 1e-6)
    const head = nets.length === 0 ? `Class ${one.name} matches no net yet` : `${nets.join(", ")} ${nets.length === 1 ? "is" : "are"} class ${one.name}: ${mm(one.trackWidth)} mm tracks, ${mm(one.clearance)} mm clearance`
    if (narrow.length === 0) return [head]
    const which = [...new Set(narrow.map((track) => netName(track.net as string)))].join(", ")
    return [`${head}; ${plural(narrow.length, "existing track")} ${narrow.length === 1 ? "is" : "are"} narrower: unroute and autoroute ${which}`]
  })
  const layers = design.pcb.board?.layers ?? 2
  const profile = design.rules.fabrication
  const mismatch = profile.copperLayers === layers ? [] : [`The profile ${profile.name} is for ${profile.copperLayers} copper layers; the board has ${layers}: fit_board { layers: ${profile.copperLayers} } changes it`]
  return [...lines, ...mismatch]
}

/** The circuit to report on: the one given, or the only one in the project. */
async function reportedCircuit(root: string, file: string | undefined): Promise<string | undefined> {
  if (file !== undefined) return (await resolveCircuit(root, file)).file
  const circuits = await listCircuits(root)
  return circuits.length === 1 ? circuits[0] : undefined
}

export async function setRulesTool(ports: Ports, input: { rules: Record<string, unknown>; file?: string | undefined }): Promise<string> {
  const circuit = await reportedCircuit(ports.root, input.file)
  const { entry, changes } = await setRules(ports.root, input.rules, { author: "ai" })
  const head = `Change ${entry.id}: ${RULES_PATH} ${changes.join(", ")}`
  if (circuit === undefined) return `${head}\nGive file to see what this means for a board.`
  try {
    return [head, ...effectLines(await buildOf(ports, circuit))].join("\n")
  } catch (error) {
    return `${head}\n${circuit} could not be built: ${(error as Error).message.split("\n")[0]}`
  }
}
