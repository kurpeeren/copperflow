// Which signal is on which pin, for the person who writes the firmware: a row per pad of a part of a built design,
// as a Markdown table, a CSV or a C header (pin-header.ts). Pure, except pinMapText, which builds the design and
// reads the library parts' titles.
import type { Design } from "../engine/design.js"
import { csvCell } from "../engine/fab/csv.js"
import type { Component, Net, PinType } from "../engine/model.js"
import { naturalCompare } from "../engine/order.js"
import { isConnector, isPowerNet } from "../engine/pcb-place/roles.js"
import { buildWith, type DesignSource } from "./design-source.js"
import { readPart } from "./library.js"
import { formatPinHeader } from "./pin-header.js"
import { resolveCircuit } from "./workspace.js"

export const NOT_CONNECTED = "not connected"

/**
 * One pad of a part. `net` is the net's name, or "not connected"; `origin` says whether a person gave the name
 * (a `net.X` in a trace, or a port's net) or the build made it up from a pin (a net written only as pin to pin).
 */
export interface PinRow {
  pad: string
  pin: string
  type: PinType
  net: string
  origin?: "given" | "made up"
  /** True for a named signal net: not power, not ground, not made up. */
  signal?: boolean
}

/** What the map is drawn for: the part's id and a title, e.g. a library part's title or the part's kind. */
export interface MappedPart {
  id: string
  title: string
  rows: PinRow[]
}

/** The parts the map shows when none is named: every library chip and every connector, in name order. */
export function pinMapParts(design: Design): string[] {
  return design.circuit.components
    .filter((c) => isLibraryChip(design, c.id) || isConnector(c))
    .map((c) => c.id)
    .sort(naturalCompare)
}

/** The library chips among the parts: the package writes a C header for each. */
export function isLibraryChip(design: Design, part: string): boolean {
  const component = design.circuit.components.find((c) => c.id === part)
  return component?.library !== undefined && component.kind === "chip"
}

function componentNamed(design: Design, part: string): Component {
  const component = design.circuit.components.find((c) => c.id === part)
  if (component) return component
  const names = design.circuit.components.map((c) => c.id).sort(naturalCompare)
  throw new Error(`No part named ${part} in ${design.file}. Parts: ${names.join(", ")}`)
}

/** A net the build named from a pin has the id "net:" + that pin and no names. */
const isMadeUp = (net: Net) => net.names.length === 0

/** A row per pad of the part, by pad number; throws, listing the parts there are, when there is no such part. */
export function pinRows(design: Design, part: string): PinRow[] {
  return signalRows(design, part).map(({ signal: _signal, ...row }) => row)
}

/** The rows with `signal` set on the named signal nets, which the header's reverse list reads. */
function signalRows(design: Design, part: string): PinRow[] {
  const component = componentNamed(design, part)
  const typeOf = new Map(design.circuit.components.flatMap((c) => c.pins.map((p) => [p.id, p.type] as const)))
  return [...component.pins]
    .sort((a, b) => a.number - b.number)
    .map((pin) => {
      const base = { pad: String(pin.number), pin: pin.names[1] ?? pin.names[0] ?? `pin${pin.number}`, type: pin.type }
      const net = design.circuit.nets.find((n) => n.pins.includes(pin.id))
      if (!net || net.pins.length < 2) return { ...base, net: NOT_CONNECTED }
      if (isMadeUp(net)) return { ...base, net: net.id.replace(/^net:/, ""), origin: "made up" as const }
      return { ...base, net: net.names[0] as string, origin: "given" as const, ...(isPowerNet(net, (p) => typeOf.get(p)) ? {} : { signal: true }) }
    })
}

/** The rows of the parts, each with its title: the library part's title, else the part's kind. */
export function mappedParts(design: Design, parts: readonly string[], titles: ReadonlyMap<string, string>): MappedPart[] {
  return parts.map((id) => ({ id, title: titles.get(id) ?? componentNamed(design, id).kind, rows: signalRows(design, id) }))
}

const mdCell = (value: string) => value.replace(/\|/g, "\\|")
const originText = (row: PinRow) => row.origin ?? ""

export function formatPinsMarkdown(parts: readonly MappedPart[]): string {
  return parts
    .map((part) =>
      [
        `## ${part.id}: ${mdCell(part.title)}`,
        "",
        "| Pad | Pin | Type | Net | Net name |",
        "| --- | --- | --- | --- | --- |",
        ...part.rows.map((r) => `| ${[r.pad, r.pin, r.type, r.net, originText(r)].map(mdCell).join(" | ")} |`),
        "",
      ].join("\n"),
    )
    .join("\n")
}

export function formatPinsCsv(parts: readonly MappedPart[]): string {
  const rows = parts.flatMap((part) => part.rows.map((r) => [part.id, r.pad, r.pin, r.type, r.net, originText(r)]))
  return `${[["Part", "Pad", "Pin", "Type", "Net", "Net name"], ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`
}

export type PinFormat = "md" | "csv" | "c"
export const PIN_FORMATS: readonly PinFormat[] = ["md", "csv", "c"]

/** The titles of the library parts among `parts`, read from the library. */
export async function libraryTitles(root: string, design: Design, parts: readonly string[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  for (const id of parts) {
    const library = design.circuit.components.find((c) => c.id === id)?.library
    if (library) titles.set(id, (await readPart(root, library)).title)
  }
  return titles
}

/** The map of a design's parts in a format; `guard` names the C header (its file name without .h). */
export function formatPins(design: Design, parts: readonly MappedPart[], format: PinFormat, guard: string): string {
  if (format === "csv") return formatPinsCsv(parts).replace(/\n$/, "")
  if (format === "c") return formatPinHeader(design.file, parts, guard)
  return formatPinsMarkdown(parts).replace(/\n$/, "")
}

/** The circuit's name for a header guard: "boards/can-node.circuit.tsx" is "can-node". */
const circuitName = (file: string) => (file.split("/").pop() ?? file).replace(/\.circuit\.tsx$/, "")

/** `copperflow pins`: one part, or every library chip and connector, in a format. */
export async function pinMapText(
  root: string,
  file: string,
  options: { part?: string; format?: PinFormat; design?: Design; engine?: DesignSource } = {},
): Promise<string> {
  const { file: circuit } = await resolveCircuit(root, file)
  const design = options.design ?? (await buildWith(root, circuit, options.engine))
  const parts = options.part !== undefined ? [componentNamed(design, options.part).id] : pinMapParts(design)
  const mapped = mappedParts(design, parts, await libraryTitles(root, design, parts))
  return formatPins(design, mapped, options.format ?? "md", options.part ?? circuitName(design.file))
}
