import { z } from "zod"
import { access } from "node:fs/promises"
import { annotationsPathFor, createCircuitFile, generateCircuit, projectPath, readAnnotations, resolveInRoot, type GeneratedInstance, type NewCircuit } from "../core/index.js"
import { COMPACT_LIMIT } from "./compact.js"
import { holeFields, pourFields } from "./pour-tools.js"
import type { DesignSource } from "../core/design-source.js"
import { autoplace } from "./place-tools.js"

const literal = z.union([z.string(), z.number(), z.boolean()])

const part = z.object({
        name: z.string().describe("e.g. R1"),
        kind: z.string().optional().describe("Built-in kind, e.g. resistor, chip, connector"),
        part: z.string().optional().describe("Library part id (instead of kind)"),
        value: literal.optional().describe('e.g. "10k", "100nF"'),
        footprint: z.string().optional().describe('e.g. "0402"'),
        props: z
          .record(z.string(), z.union([literal, z.record(z.string(), z.string())]))
          .optional()
          .describe('e.g. { "pinLabels": { "pin1": "VIN" } }; a chip or connector needs pinLabels, pinCount or a footprint'),
})
export const cardPort = z.object({ name: z.string(), type: z.string().optional(), carries: z.string().optional() })
const nets = z.record(z.string(), z.array(z.string()).min(1))

export const newCircuitInput = {
  file: z.string().describe("e.g. power.circuit.tsx"),
  parts: z.array(part).max(200).describe("May be empty when instances make them"),
  nets: nets.describe('e.g. { "GND": ["R1.pin2", "U1.GND"] }'),
  board: z.object({ width: z.number(), height: z.number() }).optional().describe("mm; default 30 x 20"),
  pages: z
    .array(z.object({ name: z.string(), parts: z.array(z.string()) }))
    .max(50)
    .optional()
    .describe('Pages after "Main", which holds the rest'),
  sheets: z
    .record(
      z.string(),
      z.object({
        parts: z.array(part).min(1).max(200),
        nets: nets.describe("A net named like a port is that port"),
        ports: z.array(z.union([z.string(), cardPort])).max(50).describe('e.g. ["GND", { name, type, carries }]'),
        does: z.string().optional(),
        sources: z.array(z.string()).max(8).optional(),
      }),
    )
    .optional()
    .describe('e.g. { "PowerStage": { parts, nets, ports, does, sources } }, each written as <name>.sheet.tsx'),
  instances: z
    .array(
      z.object({
        sheet: z.string(),
        name: z.string().describe("e.g. PS1"),
        connections: z.record(z.string(), z.string()).describe('e.g. { "VIN": "VBUS" }'),
        base: z.number().int().positive().optional().describe("100 makes R1 into R101; default 100, 200, …"),
      }),
    )
    .max(50)
    .optional()
    ,
  pours: z
    .array(z.object({ ...pourFields, layer: z.enum(["top", "bottom"]) }))
    .max(20)
    .optional()
    .describe('e.g. [{ "net": "GND", "layer": "bottom" }]'),
  holes: z.array(z.object(holeFields)).max(50).optional().describe('e.g. [{ "x": 12, "y": 7, "diameter": 3.2 }]'),
  replace: z.boolean().optional(),
  place: z.boolean().optional().describe("Default true"),
}

export const NEW_CIRCUIT_DESCRIPTION =
  "Write a whole new circuit file from a netlist in one call: parts (no positions) and nets (pin lists). Unless place is false the board is then placed too (fitted when no board is given): the placement is a second entry, undone first. A block used more than once goes in sheets and is used by instances. Nothing is written if a name, kind, part id, pin, port or base is wrong; the answer says which. An existing file is refused unless replace. guide { topic: \"writing-circuits\" } has the details. Call check_circuit once afterwards."

/** Marks and locks left from an earlier file of this name, as a line for the answer; they apply to the new file. */
async function leftovers(root: string, file: string): Promise<string | undefined> {
  const path = resolveInRoot(root, file)
  if (await access(path).then(() => true, () => false)) return undefined
  const { marks, locks } = await readAnnotations(annotationsPathFor(path))
  if (marks.length + locks.length === 0) return undefined
  return `Note: ${marks.length} marks and ${locks.length} locks from an earlier ${file} still exist and apply to this file.`
}

/** One line per instance: `PS1 PowerStage base 100: VIN=VBUS VOUT=V3_3`. */
function instanceLine(instance: GeneratedInstance): string {
  const ports = Object.entries(instance.connections).map(([port, net]) => `${port}=${net}`).join(" ")
  return `${instance.name} ${instance.sheet} base ${instance.base}: ${ports || "no connections"}`
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** "2 pours, 1 hole", or nothing when there are none. */
function boardItemsLine(spec: NewCircuit): string[] {
  const [pours, holes] = [spec.pours?.length ?? 0, spec.holes?.length ?? 0]
  return pours + holes === 0 ? [] : [`${plural(pours, "pour")}, ${plural(holes, "hole")}`]
}

/** The placement's answer lines, or why it failed: the circuit is written either way. */
async function placeAfter(root: string, file: string, fit: boolean, engine: DesignSource | undefined): Promise<string[]> {
  try {
    return (await autoplace({ root, ...(engine ? { engine } : {}) }, { file, fit })).split("\n")
  } catch (error) {
    return [`The circuit was written, but the board was not placed: ${(error as Error).message}`]
  }
}

/** Writes the circuit (and its sheet files) and answers in a few lines. */
export async function newCircuit(root: string, input: { file: string; replace?: boolean; place?: boolean } & NewCircuit, engine?: DesignSource): Promise<string> {
  const { file: written, replace, place, ...spec } = input
  const file = projectPath(root, written)
  const { text, traces, sheets, instances } = await generateCircuit(root, file, spec)
  const left = await leftovers(root, file)
  const counted = `${spec.parts.length} parts${instances.length > 0 ? `, ${instances.length} instances` : ""}`
  const entry = await createCircuitFile(root, file, text, {
    author: "ai",
    summary: `${replace ? "replace" : "create"} ${file} (${counted}, ${Object.keys(spec.nets).length} nets)`,
    ...(replace ? { replace } : {}),
    ...(sheets.length > 0 ? { sheets } : {}),
  })
  const sheetFiles = (entry.also ?? []).map((change) => change.file)
  const placed = place === false ? [] : await placeAfter(root, file, spec.board === undefined, engine)
  return [
    `Change ${entry.id}: wrote ${[entry.file, ...sheetFiles].join(", ")}`,
    counted,
    ...instances.slice(0, COMPACT_LIMIT).map(instanceLine),
    `${Object.keys(spec.nets).length} nets, ${traces} traces`,
    ...boardItemsLine(spec),
    ...(left ? [left] : []),
    ...placed,
    "Now call check_circuit once.",
  ].join("\n")
}
