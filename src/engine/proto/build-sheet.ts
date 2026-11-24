// The build sheet of a perfboard or stripboard, as Markdown: the board, each part and the holes its pins go in, the
// cut list, the link list, the solder runs, what each strip carries, and the order to build it in. Pure: the pictures
// are written beside it by the caller.
import type { CutRecord, LinkRecord, ProtoRecord, SolderRecord } from "../../core/layout-proto.js"
import type { Circuit } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PcbLayout } from "../pcb.js"
import { holeKey, holeName, parseHole, rowName, type Hole, type ProtoGrid } from "./grid.js"
import { cutKeys, protoSets } from "./joins.js"
import { pinHoles } from "./placement.js"
import { partedAlong, stripCount, stripHoles, type BoardState } from "./board-state.js"

export interface BuildSheetInput {
  name: string
  grid: ProtoGrid
  circuit: Pick<Circuit, "components" | "nets">
  layout: Pick<PcbLayout, "parts" | "proto">
  /** The picture files beside the sheet, when they were drawn. */
  pictures?: { top: string; bottom: string }
}

const mm = (value: number) => `${value.toFixed(1)} mm`
const row = (cells: readonly string[]) => `| ${cells.join(" | ")} |`
const table = (head: readonly string[], rows: readonly (readonly string[])[]) => [row(head), row(head.map(() => "---")), ...rows.map(row)]

function netNamer(circuit: BuildSheetInput["circuit"]): (net: string | undefined) => string {
  return (net) => (net === undefined ? "" : (circuit.nets.find((one) => one.id === net || one.names.includes(net))?.names[0] ?? net.replace(/^net[.:]/, "")))
}

function partRows(input: BuildSheetInput): string[][] {
  const holes = new Map<string, string[]>()
  for (const { hole, pad } of [...pinHoles(input.grid, input.layout.parts).values()]) holes.set(pad.component, [...(holes.get(pad.component) ?? []), `${holeName(hole)} (${pad.number})`])
  return input.circuit.components
    .filter((component) => holes.has(component.id))
    .sort((a, b) => naturalCompare(a.id, b.id))
    .map((component) => [component.id, component.value ?? component.kind, component.footprint ?? "", (holes.get(component.id) ?? []).sort(naturalCompare).join(", ")])
}

function linkRows(input: BuildSheetInput, nameOf: (net: string | undefined) => string): string[][] {
  return (input.layout.proto ?? [])
    .filter((r): r is LinkRecord => r.t === "link")
    .map((link) => {
      const [a, b] = [parseHole(link.from), parseHole(link.to)] as [Hole | undefined, Hole | undefined]
      const length = a && b ? mm((Math.abs(a.col - b.col) + Math.abs(a.row - b.row)) * input.grid.pitch) : ""
      return [link.id.toUpperCase(), nameOf(link.net), link.from, link.to, length]
    })
}

function cutRows(records: readonly ProtoRecord[]): string[][] {
  return records
    .filter((r): r is CutRecord => r.t === "cut")
    .map((cut) => [cut.id.toUpperCase(), cut.at !== undefined ? `at ${cut.at}: drill the hole's copper away` : `between ${cut.between?.[0]} and ${cut.between?.[1]}: cut across with a knife`])
}

function solderRows(records: readonly ProtoRecord[], nameOf: (net: string | undefined) => string): string[][] {
  return records.filter((r): r is SolderRecord => r.t === "solder").map((run) => [run.id.toUpperCase(), nameOf(run.net), run.holes.join(" → ")])
}

/** "Strip C: 1–6 GND · 8–15 V24", for each strip that carries a net, its pieces between cuts. */
export function stripLines(input: BuildSheetInput, nameOf: (net: string | undefined) => string): string[] {
  const { grid } = input
  const records = input.layout.proto ?? []
  const sets = protoSets(grid, records)
  const netOfIsland = new Map<number, string>()
  for (const [key, { pad }] of pinHoles(grid, input.layout.parts)) if (pad.net !== undefined) netOfIsland.set(sets.find(key), pad.net)
  const cuts = cutKeys(grid, records.filter((r): r is CutRecord => r.t === "cut"))
  const state: Pick<BoardState, "cutAt" | "cutBetween"> = { cutAt: new Uint8Array(grid.columns * grid.rows), cutBetween: cuts.between }
  for (const key of cuts.at) state.cutAt[key] = 1
  const lines: string[] = []
  const label = (hole: Hole) => (grid.strips === "columns" ? rowName(hole.row) : String(hole.col + 1))
  for (let strip = 0; strip < stripCount(grid); strip++) {
    const holes = stripHoles(grid, strip)
    const pieces: string[] = []
    let start = 0
    const close = (end: number) => {
      const piece = holes.slice(start, end + 1).filter((hole) => state.cutAt[holeKey(grid, hole)] !== 1)
      const first = piece[0]
      const last = piece[piece.length - 1]
      const net = first ? netOfIsland.get(sets.find(holeKey(grid, first))) : undefined
      if (first && last && net !== undefined) pieces.push(`${label(first)}–${label(last)} ${nameOf(net)}`)
    }
    for (let i = 1; i < holes.length; i++) {
      if (!partedAlong(state, holeKey(grid, holes[i - 1] as Hole), holeKey(grid, holes[i] as Hole))) continue
      close(i - 1)
      start = i
    }
    close(holes.length - 1)
    const name = grid.strips === "columns" ? `Strip ${strip + 1}` : `Strip ${rowName(strip)}`
    if (pieces.length > 0) lines.push(`- ${name}: ${pieces.join(" · ")}`)
  }
  return lines
}

/** The build sheet as Markdown. */
export function buildSheet(input: BuildSheetInput): string {
  const { grid } = input
  const nameOf = netNamer(input.circuit)
  const records = input.layout.proto ?? []
  const strips = grid.kind === "stripboard" ? `, strips along the ${grid.strips === "columns" ? "columns" : "rows"}` : ""
  const links = linkRows(input, nameOf)
  const cuts = cutRows(records)
  const solder = solderRows(records, nameOf)
  const lastRow = rowName(grid.rows - 1)
  const lines = [
    `# ${input.name}: ${grid.kind} build sheet`,
    "",
    `${grid.kind === "perfboard" ? "Perfboard" : "Stripboard"}, ${grid.columns} columns by ${grid.rows} rows of 2.54 mm holes${strips}. Rows A–${lastRow} run from the top, columns 1–${grid.columns} from the left; the bottom picture is seen from below, so its columns run right to left.`,
    ...(input.pictures ? ["", `![Top: parts and links](${input.pictures.top})`, "", `![Bottom: ${grid.kind === "stripboard" ? "strips and cuts" : "pads and solder"}](${input.pictures.bottom})`] : []),
    "",
    "## Parts",
    "",
    ...table(["Part", "Value", "Footprint", "Holes (pin)"], partRows(input)),
    "",
    ...(grid.kind === "stripboard" ? [`## Cuts (bottom, ${cuts.length})`, "", ...(cuts.length > 0 ? table(["Cut", "Where"], cuts) : ["None."]), ""] : []),
    `## Links (top, ${links.length})`,
    "",
    ...(links.length > 0 ? table(["Link", "Net", "From", "To", "Length"], links) : ["None."]),
    "",
    ...(grid.kind === "perfboard" ? [`## Solder runs (bottom, ${solder.length})`, "", ...(solder.length > 0 ? table(["Run", "Net", "Holes"], solder) : ["None."]), ""] : []),
    ...(grid.kind === "stripboard" ? ["## What each strip carries", "", ...stripLines(input, nameOf), ""] : []),
    "## Build order",
    "",
    ...buildOrder(grid),
    "",
  ]
  return lines.join("\n")
}

function buildOrder(grid: ProtoGrid): string[] {
  const steps = [
    ...(grid.kind === "stripboard" ? ["Cut the strips from the cut list on the bottom, then check with a meter that no cut strip still joins."] : []),
    "Fit the links from the link list on the top, flat on the board, and solder them.",
    "Fit the parts lowest first (resistors and diodes, then sockets and headers, then the rest) and solder their legs.",
    ...(grid.kind === "perfboard" ? ["Make the solder runs on the bottom from hole to hole, along the list."] : []),
    "Check each net with a meter against the parts list before powering it.",
  ]
  return steps.map((step, i) => `${i + 1}. ${step}`)
}

