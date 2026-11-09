import { z } from "zod"
import { BUILTIN_PARTS, createCircuitFile, generateCircuit, type NewCircuit } from "../core/index.js"

const literal = z.union([z.string(), z.number(), z.boolean()])

export const newCircuitInput = {
  file: z.string().describe("New circuit file, e.g. power.circuit.tsx"),
  parts: z
    .array(
      z.object({
        name: z.string().describe("Designator, e.g. R1 or U1"),
        kind: z.string().optional().describe(`Built-in part: ${BUILTIN_PARTS.join(", ")}`),
        part: z.string().optional().describe("Library part id from list_parts (instead of kind)"),
        value: literal.optional().describe('The main value of a built-in part: resistance "10k", capacitance "100nF", ...'),
        footprint: z.string().optional().describe('Footprint of a built-in part, e.g. "0402"'),
        props: z.record(z.string(), literal).optional().describe('Other literal props, e.g. { "pinCount": 4 }'),
      }),
    )
    .min(1)
    .max(200),
  nets: z.record(z.string(), z.array(z.string()).min(1)).describe('Net name to its pins, e.g. { "GND": ["R1.pin2", "U1.GND"] }'),
  board: z.object({ width: z.number(), height: z.number() }).optional().describe("Board size in mm; default 30 x 20"),
  replace: z.boolean().optional().describe("Overwrite the file when it exists"),
}

export const NEW_CIRCUIT_DESCRIPTION =
  "Write a whole new circuit file from a netlist in one call: the parts (no positions) and the nets (pin lists, no wire corners). The program places the parts and routes the wires. Nothing is written if a name, kind, library id or pin is wrong; the answer then lists the real pin names. One history entry; undo removes the file. An existing file is refused unless replace is true. Call check_circuit once afterwards."

/** Writes the circuit and answers in three lines. */
export async function newCircuit(root: string, input: { file: string; replace?: boolean } & NewCircuit): Promise<string> {
  const { file, replace, ...spec } = input
  const { text, traces } = await generateCircuit(root, file, spec)
  const entry = await createCircuitFile(root, file, text, {
    author: "ai",
    summary: `${replace ? "replace" : "create"} ${file} (${spec.parts.length} parts, ${Object.keys(spec.nets).length} nets)`,
    ...(replace ? { replace } : {}),
  })
  return [
    `Change ${entry.id}: wrote ${entry.file}`,
    `${spec.parts.length} parts`,
    `${Object.keys(spec.nets).length} nets, ${traces} traces`,
    "Now call check_circuit once.",
  ].join("\n")
}
