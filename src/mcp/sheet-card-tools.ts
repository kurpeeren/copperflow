// describe_sheet, and the card lines circuit_summary shows for a sheet file and for an instance.
import { z } from "zod"
import { editCircuit, loadCircuit } from "../core/index.js"
import { cardLines, readCard, type CardChange, type SheetCardText } from "../core/sheet-card.js"
import type { SheetInstance } from "../engine/model.js"
import type { SimCase } from "../engine/sim/cases.js"

export const DESCRIBE_SHEET_DESCRIPTION =
  "Write a sheet's card: does (one line), sources, each port's type and what it carries, cases for simulate. \"\" or [] removes. One history entry. Limits and a good card: guide { topic: \"modules\" }."

export const describeSheetInput = {
  file: z.string(),
  does: z.string().optional(),
  sources: z.array(z.string()).max(8).optional(),
  cases: z.array(z.unknown()).optional().describe('e.g. [{ "name": "24 V in", "set": { "IN": 24, "GND": 0 }, "expect": { "OUT": [3.2, 3.6] } }]'),
  ports: z
    .record(z.string(), z.object({ type: z.string().optional(), carries: z.string().optional() }))
    .optional()
    .describe('e.g. { "IN": { "type": "input", "carries": "0-24 V" } }'),
}

interface DescribeInput {
  file: string
  does?: string | undefined
  sources?: string[] | undefined
  cases?: unknown[] | undefined
  ports?: Record<string, { type?: string | undefined; carries?: string | undefined }> | undefined
}

/** The change as the core writes it: "" and [] remove. */
function asChange(input: DescribeInput): CardChange {
  const ports = Object.fromEntries(
    Object.entries(input.ports ?? {}).map(([name, port]) => [
      name,
      { ...(port.type !== undefined ? { type: port.type } : {}), ...(port.carries !== undefined ? { carries: port.carries === "" ? null : port.carries } : {}) },
    ]),
  )
  return {
    ...(input.does !== undefined ? { does: input.does === "" ? null : input.does } : {}),
    ...(input.sources !== undefined ? { sources: input.sources.length === 0 ? null : input.sources } : {}),
    ...(input.cases !== undefined ? { cases: input.cases.length === 0 ? null : (input.cases as SimCase[]) } : {}),
    ...(input.ports ? { ports } : {}),
  }
}

export async function describeSheetTool(root: string, input: DescribeInput): Promise<string> {
  const result = await editCircuit(root, input.file, [{ kind: "describeSheet", ...asChange(input) }], { author: "ai", summary: `describe ${input.file}` })
  const loaded = await loadCircuit(root, input.file)
  return [`Change ${result.entry.id} applied: described ${result.entry.file}`, ...cardLines(readCard(loaded.source))].join("\n")
}

/** The card of an instance as the engine read it from its sheet. */
export function instanceCard(instance: SheetInstance): SheetCardText {
  return {
    ...(instance.does ? { does: instance.does } : {}),
    ...(instance.sources ? { sources: instance.sources } : {}),
    ports: instance.ports.map(({ name, type, carries }) => ({ name, ...(type ? { type } : {}), ...(carries ? { carries } : {}) })),
  }
}

/** A summary with the card after its first line. */
export function withCard(summary: string, card: SheetCardText): string {
  const [head, ...rest] = summary.split("\n")
  return [head, ...cardLines(card), ...rest].join("\n")
}
