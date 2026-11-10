// make_sheet: parts of a circuit moved into a new sub-sheet, with an instance in their place, as one change.
import { z } from "zod"
import { makeSubSheet, type MakeSheetPreview } from "../core/index.js"
import { COMPACT_LIMIT } from "./compact.js"

export const makeSheetInput = {
  file: z.string().describe("Circuit file path relative to the project root, e.g. index.circuit.tsx"),
  name: z.string().describe("The new sheet's name, e.g. PowerStage: written as PowerStage.sheet.tsx beside the circuit"),
  parts: z.array(z.string()).min(1).max(200).describe('The parts to move, e.g. ["U2", "C4", "C5"]; the wires among them move too'),
  rename: z.boolean().optional().describe("Give the parts local designators from 1 (R5, R7 → R1, R2); default false keeps theirs"),
  instance: z.string().optional().describe("The instance's name; default the sheet's capitals and a free number, e.g. PS1"),
}

export const MAKE_SHEET_DESCRIPTION =
  "Move parts of one page into a new sub-sheet <name>.sheet.tsx and put an instance of it in their place, as one change (undo takes both files back). Every net crossing the selection's boundary becomes a port named after the net (an unnamed one after its first pin, e.g. R5_pin1), a crossing bus member a bus port with the bus's members, and the instance connects each port to its net, so the netlist stays the same. The instance takes base 100 or the next free one; its parts' designators become local designator + base."

/** `C3 → C1 (C101)`: the designator now, in the sheet and on the board. */
const mappingText = (m: MakeSheetPreview["mapping"][number]): string => (m.from === m.to ? `${m.from} (${m.flat})` : `${m.from} → ${m.to} (${m.flat})`)

/** Makes the sheet and answers in a few lines. */
export async function makeSheet(root: string, input: { file: string; name: string; parts: string[]; rename?: boolean; instance?: string }): Promise<string> {
  const { file, name, parts, rename, instance } = input
  const { entry, preview } = await makeSubSheet(root, file, { name, parts, ...(rename ? { rename } : {}), ...(instance ? { instance } : {}) }, { author: "ai" })
  const ports = preview.ports.map((port) => `${port.name}${port.bus ? " (bus)" : ""}`)
  const mapping = preview.mapping.map(mappingText)
  const more = (count: number) => (count > COMPACT_LIMIT ? ` … and ${count - COMPACT_LIMIT} more` : "")
  return [
    `Change ${entry.id}: wrote ${preview.file}; ${preview.instance} ${preview.sheet} base ${preview.base} replaces ${parts.length} parts${preview.page ? ` on page ${preview.page}` : ""}`,
    `Ports: ${ports.slice(0, COMPACT_LIMIT).join(" ") || "none"}${more(ports.length)}`,
    `Designators: ${mapping.slice(0, COMPACT_LIMIT).join(", ")}${more(mapping.length)}`,
    "Now call check_circuit once.",
  ].join("\n")
}
