import { z } from "zod"
import { access } from "node:fs/promises"
import { annotationsPathFor, BUILTIN_PARTS, createCircuitFile, generateCircuit, projectPath, readAnnotations, resolveInRoot, type GeneratedInstance, type NewCircuit } from "../core/index.js"
import { COMPACT_LIMIT } from "./compact.js"
import { holeFields, pourFields } from "./pour-tools.js"
import type { DesignSource } from "../core/design-source.js"
import { autoplace } from "./place-tools.js"

const literal = z.union([z.string(), z.number(), z.boolean()])

const part = z.object({
        name: z.string().describe("Designator, e.g. R1 or U1"),
        kind: z.string().optional().describe(`Built-in part: ${BUILTIN_PARTS.join(", ")}, chip or connector`),
        part: z.string().optional().describe("Library part id from list_parts (instead of kind)"),
        value: literal.optional().describe('The main value of a built-in part: resistance "10k", capacitance "100nF", ...'),
        footprint: z.string().optional().describe('Footprint of a built-in part, e.g. "0402"'),
        props: z
          .record(z.string(), z.union([literal, z.record(z.string(), z.string())]))
          .optional()
          .describe('Other props, e.g. { "pinLabels": { "pin1": "VIN" } }; a chip or connector needs pinLabels, pinCount or a footprint with known pads (led, diode: pin1 anode)'),
})
const nets = z.record(z.string(), z.array(z.string()).min(1))

export const newCircuitInput = {
  file: z.string().describe("New circuit file, e.g. power.circuit.tsx"),
  parts: z.array(part).max(200).describe("The circuit's own parts; may be empty when instances make them"),
  nets: nets.describe('Net name to its pins, e.g. { "GND": ["R1.pin2", "U1.GND"] }'),
  board: z.object({ width: z.number(), height: z.number() }).optional().describe("Board size in mm; default 30 x 20"),
  pages: z
    .array(z.object({ name: z.string().describe('Page name, e.g. "Power"'), parts: z.array(z.string()).describe("Names of the parts drawn on it") }))
    .max(50)
    .optional()
    .describe('Schematic pages after the first, "Main", which holds every part not listed. Pages are drawing only: a net name joins its pins on every page.'),
  sheets: z
    .record(
      z.string(),
      z.object({
        parts: z.array(part).min(1).max(200),
        nets: nets.describe("Nets inside the sheet; a net named like a port is that port's, any other is local to each instance"),
        ports: z.array(z.string()).max(50).describe('The nets an instance connects to the circuit, e.g. ["VIN", "VOUT", "GND"]'),
      }),
    )
    .optional()
    .describe('Sub-sheets by name, e.g. { "PowerStage": { parts, nets, ports } }: each is written as <name>.sheet.tsx beside the circuit, with local designators (R1, C1)'),
  instances: z
    .array(
      z.object({
        sheet: z.string().describe("A sheet given in sheets, or one whose <name>.sheet.tsx is beside the circuit"),
        name: z.string().describe("Instance name, e.g. PS1"),
        connections: z.record(z.string(), z.string()).describe('Each port to a net of the circuit, e.g. { "VIN": "VBUS", "GND": "GND" }'),
        base: z.number().int().positive().optional().describe("Added to every designator inside: base 100 makes R1 into R101. Default 100, 200, … in order"),
      }),
    )
    .max(50)
    .optional()
    .describe("Uses of the sheets; list an instance's name in pages to put it on a page"),
  pours: z
    .array(z.object({ ...pourFields, layer: z.enum(["top", "bottom"]).describe('"top" or "bottom"') }))
    .max(20)
    .optional()
    .describe('Copper pours, e.g. [{ "net": "GND", "layer": "bottom" }]: each fills the whole board, or its outline, with its net; a board gets a GND pour on the layer the parts sit on (both layers when a two-layer board is routed on both)'),
  holes: z.array(z.object(holeFields)).max(50).optional().describe("Non-plated mounting holes, e.g. [{ \"x\": 12, \"y\": 7, \"diameter\": 3.2 }]"),
  replace: z.boolean().optional().describe("Overwrite the file and its sheet files when they exist"),
  place: z.boolean().optional().describe("Place the parts on the board after writing (default true), as a second change; without board, the board is then fitted round them. false leaves them unplaced"),
}

export const NEW_CIRCUIT_DESCRIPTION =
  "Write a whole new circuit file from a netlist in one call: the parts (no positions) and the nets (pin lists, no wire corners). The program places the parts (on the board too: autoplace runs after writing, and fits the board when no board size is given, unless place is false) and routes the schematic wires. A block used more than once goes in sheets (written once as <name>.sheet.tsx) and is placed by instances, each joining the sheet's ports to the circuit's nets. Nothing is written if a name, kind, library id, pin, port or base is wrong; the answer then says what is. One history entry for the circuit and its sheet files, and when the board is placed the placement is a second entry: undo takes the placement back first, leaving the file as written without positions, and a second undo removes the files. An existing file is refused unless replace is true. Call check_circuit once afterwards."

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
