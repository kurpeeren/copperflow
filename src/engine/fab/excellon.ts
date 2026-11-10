// The Excellon drill files: plated holes (through pads and vias) and non-plated holes, in millimetres (METRIC, FMAT,2),
// one tool per hole diameter from the smallest, slots as G85 routes, X2 attributes as comments. Pure: the same board and
// creation date give the same bytes. copperflow's own code, written from the Excellon and Gerber X2 specifications.
import { boardCopperLayers } from "../../core/layout-file.js"
import type { Point } from "../model.js"
import type { PcbLayout, WorldPad } from "../pcb.js"
import { VERSION } from "../../version.js"
import { creationDate } from "./gerber.js"
import { fabFileName } from "./names.js"

/** A drilled hole, or a slot routed from `from` to `to` with a tool of `diameter`. */
export interface DrillHole {
  diameter: number
  at: Point
  /** Set for a slot: where the route ends; `at` is where it starts. */
  to?: Point
  /** The X2 drill function: a component's hole, a via's, or a non-plated mounting hole's. */
  function: "ComponentDrill" | "ViaDrill" | "MechanicalDrill"
}

/** Three decimals: whole micrometres, finer than any drill. */
const DECIMALS = 3
const SCALE = 10 ** DECIMALS

const number = (mm: number): string => ((Math.round(mm * SCALE) + 0) / SCALE).toFixed(DECIMALS)
const at = (p: Point): string => `X${number(p.x)}Y${number(p.y)}`

/** A through pad's hole: round when its drill is, else a slot along the drill's long side, turned with the pad. */
function padHole(pad: WorldPad & { drill: { width: number; height: number } }): DrillHole {
  const { width, height } = pad.drill
  const centre = { x: pad.x, y: pad.y }
  if (width === height) return { diameter: width, at: centre, function: "ComponentDrill" }
  const along = width > height
  const half = Math.abs(width - height) / 2
  const radians = ((pad.rotation + (along ? 0 : 90)) * Math.PI) / 180
  const [dx, dy] = [half * Math.cos(radians), half * Math.sin(radians)]
  return { diameter: Math.min(width, height), at: { x: pad.x - dx, y: pad.y - dy }, to: { x: pad.x + dx, y: pad.y + dy }, function: "ComponentDrill" }
}

/** The board's holes: plated (through pads, then vias, in model order) and non-plated (the board's holes, in source order). */
export function drillHoles(pcb: PcbLayout): { plated: DrillHole[]; nonPlated: DrillHole[] } {
  const pads = pcb.parts
    .flatMap((part) => part.pads)
    .filter((pad): pad is WorldPad & { drill: { width: number; height: number } } => pad.layers === "through" && pad.drill !== undefined)
    .map(padHole)
  const vias = pcb.vias.filter((via) => via.missingLayer === undefined).map((via): DrillHole => ({ diameter: via.drill, at: via.at, function: "ViaDrill" }))
  const holes = pcb.holes.map((hole): DrillHole => ({ diameter: hole.diameter, at: { x: hole.x, y: hole.y }, function: "MechanicalDrill" }))
  return { plated: [...pads, ...vias], nonPlated: holes }
}

interface Tool {
  diameter: string
  holes: DrillHole[]
}

/** One tool per diameter (as written, so equal diameters share one), from the smallest. */
function tools(holes: readonly DrillHole[]): Tool[] {
  const byDiameter = new Map<string, DrillHole[]>()
  for (const hole of holes) {
    const key = number(hole.diameter)
    byDiameter.set(key, [...(byDiameter.get(key) ?? []), hole])
  }
  return [...byDiameter.entries()].sort(([a], [b]) => Number(a) - Number(b)).map(([diameter, list]) => ({ diameter, holes: list }))
}

/** The whole file, LF line ends, ending in M30. `copperLayers` is the span of a plated hole: layer 1 to the last. */
export function writeExcellon(holes: readonly DrillHole[], plated: boolean, copperLayers: number, created: Date): string {
  const kind = plated ? "Plated" : "NonPlated"
  const short = plated ? "PTH" : "NPTH"
  const list = tools(holes)
  const definitions = list.flatMap((tool, i) => {
    const functions = new Set(tool.holes.map((hole) => hole.function))
    const only = functions.size === 1 ? [...functions][0] : undefined
    return [...(only === undefined ? [] : [`; #@! TA.AperFunction,${kind},${short},${only}`]), `T${i + 1}C${tool.diameter}`]
  })
  const body = list.flatMap((tool, i) => [`T${i + 1}`, ...tool.holes.map((hole) => (hole.to === undefined ? at(hole.at) : `${at(hole.at)}G85${at(hole.to)}`))])
  const lines = [
    "M48",
    `; DRILL file copperflow ${VERSION}`,
    "; FORMAT={-:-/ absolute / metric / decimal}",
    `; #@! TF.GenerationSoftware,copperflow,copperflow,${VERSION}`,
    `; #@! TF.CreationDate,${creationDate(created)}`,
    `; #@! TF.FileFunction,${kind},1,${copperLayers},${short}`,
    "FMAT,2",
    "METRIC",
    ...definitions,
    "%",
    "G90",
    "G05",
    ...body,
    "M30",
  ]
  return `${lines.join("\n")}\n`
}

/** The plated and the non-plated drill file of the board for the design `name`. */
export function drillFiles(pcb: PcbLayout, name: string, created: Date): { file: string; text: string }[] {
  const { plated, nonPlated } = drillHoles(pcb)
  const layers = boardCopperLayers(pcb.board?.layers ?? 2).length
  return [
    { file: fabFileName(name, "PTH"), text: writeExcellon(plated, true, layers, created) },
    { file: fabFileName(name, "NPTH"), text: writeExcellon(nonPlated, false, layers, created) },
  ]
}
