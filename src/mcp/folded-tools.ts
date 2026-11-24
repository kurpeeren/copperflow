// The tools that took in another of the same kind in the tool fold: each keeps its own arguments and adds the folded
// tool's, then hands the call to the handler that tool had, so the answers and refusals are the ones it gave. A call
// that mixes the two tools' arguments is refused before anything is written.
import { z } from "zod"
import { allLibraryModules, isLibraryName, libraryModuleInfo } from "../core/library-modules.js"
import { listModules, moduleInfo } from "../core/modules.js"
import type { ProjectUpdate } from "../core/project.js"
import { BOARD_DESCRIPTION, boardInput, boardTool, type BoardInput } from "./board-tool.js"
import { importBoardTool } from "./board-import-tool.js"
import { BOARD_KINDS, boardKindTool, type BoardKind } from "./proto-board.js"
import { addVia, removeCopper, removeCopperInput, routeTrack, ROUTE_TRACK_DESCRIPTION, routeTrackInput, type CopperRemoval, type Ports, type RouteTrackRequest } from "./copper-tools.js"
import { attachDatasheetTool } from "./datasheet-tools.js"
import { filletTracks, filletTracksInput, straightenTracks } from "./fillet-tools.js"
import { SET_PART_FIELDS_DESCRIPTION, setPartFieldsInput, setPartFieldsTool } from "./part-tools.js"
import { NOTE_DECISION_DESCRIPTION, noteDecisionInput, noteDecisionTool, setProjectInput, setProjectTool } from "./project-tools.js"
import { unroute } from "./route-tools.js"

const point = z.object({ x: z.number(), y: z.number() })
const copperLayer = z.enum(["top", "bottom", "inner1", "inner2"])
const NOTHING = "Nothing was written."

/** The names among `keys` that the input gives; false says the same as leaving a flag out. */
const given = (input: object, keys: readonly string[]) => keys.filter((key) => ![undefined, false].includes((input as Record<string, unknown>)[key] as undefined))

/** Refuses the arguments of one form when the other form is asked for. */
function refuseWith(input: object, keys: readonly string[], form: string): void {
  const extra = given(input, keys)
  if (extra.length > 0) throw new Error(`${extra.join(", ")} ${extra.length === 1 ? "is" : "are"} not taken with ${form}. ${NOTHING}`)
}

// route_track: a track, or with at a via (add_via).

const TRACK_KEYS = ["points", "from", "to", "via", "width", "layer"] as const

export const routeInput = {
  ...routeTrackInput,
  at: point.optional().describe("A via's centre in mm, instead of a track"),
  layers: z.array(copperLayer).min(2).optional().describe('The via\'s layers; default ["top", "bottom"]'),
}

export const ROUTE_DESCRIPTION = `${ROUTE_TRACK_DESCRIPTION} at places a via by hand instead, as ONE change; its net is that of the copper under it unless net is given.`

type RouteInput = RouteTrackRequest & { at?: { x: number; y: number } | undefined; layers?: z.infer<typeof copperLayer>[] | undefined }

export function routeTool(ports: Ports, input: RouteInput): Promise<string> {
  const { at, layers, ...track } = input
  if (at === undefined) {
    refuseWith(input, ["layers"], "a track (layers is a via's; give at)")
    return routeTrack(ports, track)
  }
  refuseWith(input, TRACK_KEYS, "at (a via)")
  return addVia(ports, { file: input.file, at, ...(input.net !== undefined ? { net: input.net } : {}), ...(layers !== undefined ? { layers } : {}) })
}

// remove_copper: by id, or the router's copper of nets or all (unroute).

export const removeInput = {
  ...removeCopperInput,
  ids: removeCopperInput.ids.optional(),
  nets: z.array(z.string().min(1)).min(1).max(200).optional().describe("The router's copper of these nets"),
  all: z.boolean().optional().describe("All the router's copper"),
}

export const REMOVE_DESCRIPTION =
  'Remove tracks and vias by id (from circuit_summary view "copper" or check_circuit) as ONE change; { id, segment } removes one segment. Locked copper is refused. Or nets, or all: true, removes the router\'s copper of those nets (and copper shorting them) or all of it, as ONE change; hand-drawn and locked copper stay.'

type RemoveInput = { file: string; ids?: CopperRemoval[] | undefined; nets?: string[] | undefined; all?: boolean | undefined }

export function removeTool(ports: Ports, input: RemoveInput): Promise<string> {
  if (input.ids !== undefined) {
    refuseWith(input, ["nets", "all"], "ids (nets and all remove the router's copper)")
    return removeCopper(ports, { file: input.file, ids: input.ids })
  }
  if (input.nets === undefined && input.all === undefined) return Promise.reject(new Error(`Give ids, nets or all: true. ${NOTHING}`))
  return unroute(ports, input)
}

// fillet_tracks: round the corners, or with square put them back (straighten_tracks).

export const filletInput = { ...filletTracksInput, square: z.boolean().optional().describe("Put back square corners instead") }

export const FILLET_DESCRIPTION =
  "Round the square corners of tracks as ONE change. A corner stays square where the arc would break clearance; the answer counts those with reasons. Locked tracks are left alone. square: true puts back the square corners instead, where clearance allows."

export function filletTool(ports: Ports, input: { file: string; ids?: string[] | undefined; radius?: number | undefined; square?: boolean | undefined }): Promise<string> {
  const ids = input.ids ? { ids: input.ids } : {}
  if (input.square !== true) return filletTracks(ports, { file: input.file, ...ids, ...(input.radius === undefined ? {} : { radius: input.radius }) })
  refuseWith(input, ["radius"], "square: true")
  return straightenTracks(ports, { file: input.file, ...ids })
}

// fit_board: the board's size and shape, or with drawing from a DXF, SVG or KiCad board (import_board).

const SHAPE_KEYS = ["margin", "width", "height", "x", "y", "outline", "layers"] as const
const DRAWING_KEYS = ["dxfLayer", "units", "origin", "replace"] as const

export const fitInput = {
  ...boardInput,
  drawing: z.string().optional().describe("A DXF, SVG (sized in mm, in…) or KiCad board in the project folder, e.g. case.dxf or old.kicad_pcb"),
  dxfLayer: z.string().optional().describe("DXF: only this layer may make the outline"),
  units: z.enum(["mm", "inch"]).optional().describe("Overrides the drawing's own units"),
  origin: z.enum(["centre", "keep"]).optional().describe('"centre" (default) centres the outline on the origin; "keep" leaves it as drawn'),
  replace: z.boolean().optional().describe("Replace the board's holes and keepouts; without it a board that has some is refused"),
  kind: z.enum(BOARD_KINDS).optional(),
}

export const FIT_DESCRIPTION = `${BOARD_DESCRIPTION} Or drawing: the board from a DXF or SVG drawing; the largest closed shape is the outline, circles in it mounting holes, other shapes keepouts; parts are not moved and the answer lists those now outside. A .kicad_pcb instead makes file a new circuit (outline, parts, nets, copper); the answer lists what did not come over. kind "perfboard" or "stripboard": a 2.54 mm hole grid, parts put on holes.`

type FitInput = BoardInput & {
  kind?: BoardKind | undefined
  drawing?: string | undefined
  dxfLayer?: string | undefined
  units?: "mm" | "inch" | undefined
  origin?: "centre" | "keep" | undefined
  replace?: boolean | undefined
}

export async function fitTool(ports: Ports, input: FitInput): Promise<string> {
  const { drawing, dxfLayer, units, origin, replace, kind, ...board } = input
  if (kind !== undefined) {
    const extra = Object.keys(input).filter((key) => key !== "file" && key !== "kind" && input[key as keyof FitInput] !== undefined)
    if (extra.length > 0) throw new Error(`kind changes the board alone; leave out ${extra.join(", ")}. Nothing was written.`)
    return boardKindTool(ports, { file: input.file, kind })
  }
  if (drawing === undefined) {
    refuseWith(input, DRAWING_KEYS, "the board's shape (they are for a drawing)")
    return boardTool(ports, board)
  }
  refuseWith(input, SHAPE_KEYS, "drawing")
  const options = { ...(dxfLayer !== undefined ? { layer: dxfLayer } : {}), ...(units ? { units } : {}), ...(origin ? { origin } : {}), ...(replace !== undefined ? { replace } : {}) }
  return importBoardTool(ports, { file: input.file, dxf: drawing, ...options })
}

// list_parts: the library, or with id one part (part_info).

export const LIST_PARTS_DESCRIPTION =
  'List the parts library (parts/) with verification status; id: one part\'s part.yaml, its footprint\'s pads and the verification checklist. Built-in kinds (resistor, capacitor, led, pinheader, …) are not here: guide { topic: "writing-circuits" } lists them.'

export const listPartsInput = { id: z.string().optional().describe("One library part") }

// set_part_fields: fields, or with datasheet the datasheet the pins came from (attach_datasheet).

export const partFieldsInput = {
  ...setPartFieldsInput,
  datasheet: z
    .object({
      url: z.string().max(2000).describe("http(s) link"),
      title: z.string().max(200).optional(),
      pages: z.string().max(100).optional().describe('Pin table pages, e.g. "3-4"'),
    })
    .optional(),
}

export const PART_FIELDS_DESCRIPTION = `${SET_PART_FIELDS_DESCRIPTION} Or datasheet alone: record the datasheet the part's pins came from (link, title, pages) in part.yaml and verification.md; the link is not fetched.`

type PartFieldsInput = Parameters<typeof setPartFieldsTool>[1] & { datasheet?: { url: string; title?: string | undefined; pages?: string | undefined } | undefined }

export function partFieldsTool(root: string, input: PartFieldsInput): Promise<string> {
  const { datasheet, ...fields } = input
  if (datasheet === undefined) return setPartFieldsTool(root, fields)
  refuseWith(input, ["suppliers", "mpn", "manufacturer", "description"], "datasheet (set the fields in another call)")
  return attachDatasheetTool(root, { part: input.id, ...datasheet })
}

// note_decision: a decision or an open item, or with sections PROJECT.md's sections (set_project).

export const noteInput = {
  ...noteDecisionInput,
  text: noteDecisionInput.text.optional(),
  sections: z.object(setProjectInput).optional().describe("Instead of text"),
}

export const NOTE_DESCRIPTION = `${NOTE_DECISION_DESCRIPTION} Or sections alone: rewrite intent (at most 2000 characters), blocks (at most 50 { name, does, status }) and open (at most 50 non-empty strings) as ONE change; sections not given and Decisions stay.`

type NoteInput = { file?: string | undefined; text?: string | undefined; open?: boolean | undefined; sections?: ProjectUpdate | undefined }

export function noteTool(ports: Ports, input: NoteInput): Promise<string> {
  const { sections, text, ...rest } = input
  if (sections === undefined) {
    if (text === undefined) return Promise.reject(new Error(`Give text (a decision, or an open item with open: true) or sections. ${NOTHING}`))
    return noteDecisionTool(ports, { ...rest, text })
  }
  refuseWith(input, ["text", "open", "file"], "sections")
  return setProjectTool(ports, sections)
}

// list_modules: the shelf and the libraries, or with name one module (module_info).

export const LIST_MODULES_DESCRIPTION =
  "List the modules: the person's shelf, then each library's (named library/Name), one line each. Look here before designing a block. name reads one before using it: what it does, each port's type and what it carries, its parts, sources and origin; an unknown name is refused. use_module copies it."

export const listModulesInput = {
  filter: z.string().optional().describe("Words to narrow the list"),
  name: z.string().optional().describe("One module, as the list shows it: Name or library/Name"),
}

export async function listModulesTool(input: { filter?: string | undefined; name?: string | undefined }): Promise<string> {
  if (input.name === undefined) return listModules(input.filter, await allLibraryModules())
  refuseWith(input, ["filter"], "name")
  return isLibraryName(input.name) ? libraryModuleInfo(input.name) : moduleInfo(input.name)
}
