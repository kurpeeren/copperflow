// make_sheet: parts of a circuit moved into a new sub-sheet, with an instance in their place, as one change.
import { z } from "zod"
import { makeSubSheet, type MakeSheetPreview } from "../core/index.js"
import type { DesignSource } from "../core/design-source.js"
import { COMPACT_LIMIT } from "./compact.js"

export const makeSheetInput = {
  file: z.string().describe("Circuit file"),
  name: z.string().describe("e.g. PowerStage"),
  parts: z.array(z.string()).min(1).max(200).describe('e.g. ["U2", "C4"]'),
  rename: z.boolean().optional().describe("Number the parts from 1"),
  instance: z.string().optional().describe("Default e.g. PowerStage1"),
}

export const MAKE_SHEET_DESCRIPTION =
  "Move parts into a new sub-sheet <name>.sheet.tsx and put an instance of it in their place, as ONE change. Each net crossing the boundary becomes a port of that name, so the netlist stays the same."

/** `C3 → C1 (C101)`: the designator now, in the sheet and on the board. */
const mappingText = (m: MakeSheetPreview["mapping"][number]): string => (m.from === m.to ? `${m.from} (${m.flat})` : `${m.from} → ${m.to} (${m.flat})`)

/** Makes the sheet and answers in a few lines. */
export async function makeSheet(root: string, input: { file: string; name: string; parts: string[]; rename?: boolean; instance?: string }, engine?: DesignSource): Promise<string> {
  const { file, name, parts, rename, instance } = input
  const { entry, preview } = await makeSubSheet(root, file, { name, parts, ...(rename ? { rename } : {}), ...(instance ? { instance } : {}) }, { author: "ai", ...(engine ? { engine } : {}) })
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
