// What a menu or toolbar command does: the app's own commands run here, the workspace's run as their keys do, and
// the rest go to the open canvas over the command bus (command-owners.ts says which is which). A view's own commands
// (the schematic's tools, the PCB's routing) sent while the other view is open switch to it first.
import { useCallback, useEffect, useState } from "react"
import { api, type BomLine, type CircuitData, type FabricationExport } from "../api"
import { bomCsv, bomFileName } from "./bom-csv"
import { exportAsks, fabricationNote } from "./fabrication-note"
import type { CheckCounts } from "../../../src/core/checks-line.js"
import type { Actions } from "../App"
import { keyAction, keyInput, type KeyActionName } from "../pcb/canvas-keys"
import { copperLock, type CopperRecords } from "../pcb/copper-edits"
import { selectionLockChange } from "../pcb/pour-props"
import type { PickLayers } from "../pcb/layers"
import { selectAll } from "../pcb/pick"
import { instancePart, instanceSelection, topInstance } from "../pcb/instances"
import { replicatePlan } from "../pcb/replicate"
import type { PickFilter } from "../pcb/pick-filter"
import type { View } from "../pcb/positions"
import type { Selection, SelectionChange } from "../selection"
import type { ThemeName } from "./theme-state"
import type { BottomTab } from "./bottom-state"
import { commandView, WORKSPACE_COMMANDS, type AppCommand } from "./command-owners"
import { POUR_FILL_COMMANDS, type PourFillMode } from "../pcb/pour-view"
import { send } from "./commands"
import type { DialogName } from "./Dialogs"
import type { CommandId } from "./menus"
import { makeSheetStart } from "./make-sheet-form"
import { openPackagesToLook } from "./packages-request"
import { netScope, selectionScope, unrouteRequest, type Refusal } from "../pcb/autoroute"
import { placeInstanceScope, placeSelectionScope } from "../pcb/autoplace"
import type { PlaceScope } from "../api"
import type { RouteScope } from "../api"
import { runPageCommand, type PageCommand } from "./page-commands"
import { openPrint, printSheets } from "./print-render"
import { annotateDesignators, copySelection, flipSelection, pasteCopied, selectSimilar, transferPlacement } from "./part-commands"
import type { Design } from "../api"
import { desktopBridge } from "./desktop-bridge"
import { showProjects } from "./projects-command"

const WORKSPACE: Partial<Record<CommandId, KeyActionName>> = WORKSPACE_COMMANDS

/** The workspace functions the commands use; each is stable across renders. */
interface WorkspaceCommands {
  run(action: KeyActionName): void
  openBottom(tab: BottomTab): void
  openPageTree(): void
  setTheme(theme: ThemeName): void
  toggleHoverLabels(): void
  setPourFill(mode: PourFillMode): void
}

interface Input {
  file: string | undefined
  /** Opens a circuit a KiCad import just wrote, after the file list is read again. */
  openImported(file: string): void
  view: View
  setView(view: View): void
  selection: Selection
  select(change: SelectionChange): void
  /** The open circuit: its parts for Select all, its locks for Lock and Unlock. */
  circuit: CircuitData | undefined
  actions: Actions
  /** On the PCB, which layers are shown: Select all leaves out the parts that are only on hidden ones. */
  pickLayers: PickLayers | undefined
  /** The Filter tab: Select all takes no parts while Parts is off. */
  pickFilter: PickFilter
  /** On the schematic, the ids of the wires the sheet draws, which Select all takes too; none on the PCB. */
  sheetWires: readonly string[]
  /** On the schematic, the ids of its net labels and flags, which Select all takes too; none on the PCB. */
  sheetLabels: readonly string[]
  /** On the schematic, the ids of its drawings, which Select all takes too; none on the PCB. */
  sheetDrawings: readonly string[]
  /** On the PCB, the tracks and vias on shown layers, which Select all takes too; none on the schematic. */
  pcbCopper: readonly { kind: "track" | "via"; id: string }[]
  /** On the PCB, the layout file's tracks and vias, which Lock and Unlock change for the copper selected. */
  copperRecords: CopperRecords | undefined
  workspace: WorkspaceCommands
  openChecks(): void
  /** The DRC tab's counts: Export → Fabrication files asks first when they have errors. */
  checkCounts: CheckCounts
  /** Opens the find box and focuses its field, or selects the text of the field when the box is open. */
  openFind(): void
  openDialog(name: DialogName): void
  /** The design, for its schematic pages. */
  design: Design | undefined
  /** The schematic page that is open. */
  page: string
  openPage(page: string): void
  /** The highlighted nets: Autoroute net routes the one the Nets panel's row highlights. */
  highlight: readonly string[]
}

/** Route → Autoroute selection and Autoroute net: routes the scope, or says why there is none. */
function routeScope(input: Input, scope: RouteScope | Refusal): void {
  if ("message" in scope) return input.actions.notify(scope.message)
  void input.actions.route(scope)
}

/** Place → Autoplace selection and Autoplace instance: places the scope, or says why there is none. */
function placeScope(input: Input, scope: PlaceScope | Refusal): void {
  if ("message" in scope) return input.actions.notify(scope.message)
  void input.actions.autoplace(scope)
}

/** Route → Unroute: the selected router copper, or with no copper selected all of it. */
function unroute(input: Input): void {
  const locked = new Set(input.circuit?.annotations.locks.filter((lock) => !lock.drawing).map((lock) => lock.part))
  const request = unrouteRequest(input.design, input.selection.copper, locked)
  if ("message" in request) return input.actions.notify(request.message)
  void input.actions.unroute(request.ids)
}

/** Design → Add, Rename or Delete page, on the open schematic page; the name is asked for in the browser's prompt. */
function pageCommand(input: Input, command: PageCommand): void {
  const { design, page, actions, openPage } = input
  const ask = (question: string, initial: string) => window.prompt(question, initial)
  void runPageCommand(command, { design, page, edit: actions.edit, notify: actions.notify, ask, openPage })
}

function exportPackage(file: string | undefined, actions: Actions): void {
  if (!file) return
  actions.notify("Exporting the BOM and datasheets…")
  api<{ outDir: string; files: string[] }>("/api/package", { file })
    .then((result) => actions.notify(`Exported ${result.files.length} files to ${result.outDir}`))
    .catch((error: Error) => actions.notify(error.message))
}

/**
 * File → Print… and Export → PDF…: every schematic page and the board on A4 landscape sheets, printed through the
 * browser; PDF is the print dialog's "Save as PDF".
 */
function printDesign(input: Input, pdf: boolean): void {
  const { design, file, actions } = input
  if (!design || !file) return actions.notify("Wait for the build to finish, then try again.")
  const sheets = printSheets(design, file)
  if (sheets.length === 0) return actions.notify("Nothing to print yet: the circuit has no parts.")
  const name = file.replace(/\.circuit\.tsx$/, "")
  if (!openPrint(name, sheets)) return actions.notify("The browser blocked the print window; allow pop-ups for Studio and try again.")
  actions.notify(pdf ? `Choose "Save as PDF" in the print dialog to save ${name}.pdf (${sheets.length} sheets)` : `Printing ${sheets.length} sheets`)
}

/** What an export says when no circuit is open, rather than doing nothing. */
const NO_CIRCUIT_OPEN = "Open a circuit first"

/** Export → Fabrication files (JLCPCB): asks first when the checks report errors, else writes the files. */
function exportFabrication(input: Input): void {
  if (!input.file) return input.actions.notify(NO_CIRCUIT_OPEN)
  if (exportAsks(input.checkCounts)) return input.openDialog("exportChecks")
  writeFabricationFiles(input.file, input.actions)
}

/** Writes the fabrication files beside the circuit through the server; the note says where, or why not. */
export function writeFabricationFiles(file: string | undefined, actions: Pick<Actions, "notify">): void {
  if (!file) return
  actions.notify("Writing the fabrication files…")
  api<FabricationExport>("/api/export", { file })
    .then((result) => actions.notify(fabricationNote(result)))
    .catch((error: Error) => actions.notify(error.message))
}

/** File → Export web page (HTML): the design as one page beside the circuit, written by the server; the note says where. */
function exportHtml(file: string | undefined, actions: Actions): void {
  if (!file) return actions.notify(NO_CIRCUIT_OPEN)
  actions.notify("Writing the web page…")
  api<{ file: string; bytes: number }>("/api/html", { file })
    .then((result) => actions.notify(`Wrote ${result.file} (${Math.max(1, Math.round(result.bytes / 1000))} kB): the design as one web page with its files inside`))
    .catch((error: Error) => actions.notify(error.message))
}

/** Saves the BOM as a CSV file through the browser's download. */
/** The largest drawing the Studio sends; the server takes requests up to 1 MB. */
const MAX_DRAWING_BYTES = 1000 * 1000

/** File → Import board (DXF, SVG or KiCad)…: the system file picker, then the file's text to the server; a KiCad board opens as a new circuit. */
function pickBoardDrawing(actions: Actions, openImported: (file: string) => void): void {
  const picker = Object.assign(document.createElement("input"), { type: "file", accept: ".dxf,.svg,.kicad_pcb" })
  picker.addEventListener("change", () => {
    const picked = picker.files?.[0]
    if (!picked) return
    const kicad = /\.kicad_pcb$/i.test(picked.name)
    if (picked.size > MAX_DRAWING_BYTES) return actions.notify(`${picked.name} is larger than 1 MB; import it with the agent's fit_board { drawing } or ${kicad ? "copperflow import kicad" : "copperflow board --dxf"}`)
    picked
      .text()
      .then(async (text) => {
        if (!kicad) return void (await actions.importBoard(picked.name, text))
        const made = await actions.importKicad(picked.name, text)
        if (made !== undefined) openImported(made)
      })
      .catch((error: Error) => actions.notify(error.message))
  })
  picker.click()
}

function exportBom(file: string | undefined, actions: Actions): void {
  if (!file) return
  api<{ lines: BomLine[] }>(`/api/bom?file=${encodeURIComponent(file)}`)
    .then(({ lines }) => {
      const url = URL.createObjectURL(new Blob([bomCsv(lines)], { type: "text/csv" }))
      const link = Object.assign(document.createElement("a"), { href: url, download: bomFileName(file) })
      link.click()
      URL.revokeObjectURL(url)
      actions.notify(`Saved ${bomFileName(file)}`)
    })
    .catch((error: Error) => actions.notify(error.message))
}

/** Locks or unlocks the selected copper (one layout edit), then the selected parts, pours and holes. */
function lockSelection(input: Input, locked: boolean): void {
  const { copper } = input.selection
  if (copper.length > 0 && input.copperRecords) {
    const change = copperLock(input.copperRecords, copper, locked)
    if ("message" in change) input.actions.notify(change.message)
    else void input.actions.editLayout(change.edits, change.summary)
    if (input.selection.size + input.selection.boardCount === 0) return
  }
  lockParts(input, locked)
}

/**
 * Locks or unlocks every selected part, pour and hole that is not so already (or, for Lock, was changed outside the
 * editor), in one call: parts by name, pours and holes by id.
 */
function lockParts(input: Input, locked: boolean): void {
  const now = new Set(input.circuit?.annotations.locks.map((lock) => lock.part))
  const violated = new Set(input.circuit?.violations.map((violation) => violation.part))
  const change = selectionLockChange(input.selection, now, locked, violated)
  if ("message" in change) return input.actions.notify(change.message)
  void input.actions.lock(change.parts, locked)
}

/** Select → "Select the instance": every part of the instance each selected part (or symbol) is in. */
function selectInstance(input: Input): void {
  const parts = instanceSelection(input.design, input.selection.names)
  if (!parts) return input.actions.notify("Select a part of a sub-sheet instance, or its symbol on the schematic, first.")
  // The schematic draws the instance as one symbol: selecting it there is selecting the instance.
  const shown = input.view === "schematic" ? input.selection.names.flatMap((name) => topInstance(input.design, name)?.path ?? instancePart(input.design, name)?.outer ?? []) : parts
  input.select((current) => current.all([...new Set(shown)]))
}

/**
 * Layout → Replicate layout: the selected instance's placement and copper copied to the other instances of its sheet
 * (replicate.ts), as one history entry: the copper in the layout file, the placement in the sheet file with it.
 */
async function replicateLayout(input: Input): Promise<void> {
  // Placed means pcbX and pcbY written on the instance, as the circuit file has it.
  const placed = (name: string) => {
    const props = input.circuit?.model.parts.find((part) => part.name === name)?.props
    return props?.["pcbX"] !== undefined && props["pcbY"] !== undefined
  }
  const locked = new Set(input.circuit?.annotations.locks.map((lock) => lock.part))
  const plan = replicatePlan(input.design, input.selection.names, placed, locked)
  if ("message" in plan) return input.actions.notify(plan.message)
  const { sheet, layout } = plan
  // One history entry: the copper in the layout file, the placement in the sheet file beside it (`also`).
  const written =
    layout.edits.length === 0
      ? await input.actions.editFile(sheet.file, sheet.edits, sheet.summary)
      : await input.actions.editLayout(layout.edits, sheet.edits.length === 0 ? layout.summary : `${layout.summary} and its placement`, sheet.edits.length === 0 ? undefined : { file: sheet.file, edits: sheet.edits })
  if (!written.ok) return
  input.actions.notify(`Copied the layout of ${plan.source} to ${plan.targets.join(", ")}`)
}

/** Edit → Make sub-sheet…: the dialog opens for parts of one page; otherwise the note says why not. */
function makeSheet(input: Input): void {
  const start = makeSheetStart(input.circuit?.model, input.selection.names)
  if ("message" in start) return input.actions.notify(start.message)
  input.openDialog("makeSheet")
}

/** The app's own commands; undefined for the ones the canvases answer. */
function appCommand(input: Input, command: CommandId): (() => void) | undefined {
  const action = WORKSPACE[command]
  if (action) return () => input.workspace.run(action)
  const table: Record<AppCommand, () => void> = {
    projects: () => void showProjects(desktopBridge(), input.actions.notify),
    openFile: input.workspace.openPageTree,
    exportBom: () => exportBom(input.file, input.actions),
    exportPackage: () => exportPackage(input.file, input.actions),
    exportFabrication: () => exportFabrication(input),
    exportHtml: () => exportHtml(input.file, input.actions),
    undo: () => void input.actions.undo(),
    redo: () => void input.actions.redo(),
    // Every part of the circuit that may be picked (both views show the same parts, and the circuit is there before a
    // canvas is), and on the schematic every wire of the sheet.
    selectAll: () => input.select(selectAll(input.circuit?.model.parts.map((part) => part.name) ?? [], input.pickLayers, input.pickFilter, input.sheetWires, input.sheetLabels, input.sheetDrawings, input.pcbCopper)),
    selectInstance: () => selectInstance(input),
    replicateLayout: () => void replicateLayout(input),
    makeSheet: () => makeSheet(input),
    find: input.openFind,
    checkDrc: input.openChecks,
    designRules: () => input.openDialog("rules"),
    autoplace: () => placeScope(input, { kind: "all" }),
    autoplaceSelection: () => placeScope(input, placeSelectionScope(input.design, input.selection.names)),
    autoplaceInstance: () => placeScope(input, placeInstanceScope(input.design, input.selection.names)),
    fitBoard: () => void input.actions.fitBoard(),
    importBoardDxf: () => pickBoardDrawing(input.actions, input.openImported),
    importGraphic: () => (input.file ? input.openDialog("importGraphic") : input.actions.notify(NO_CIRCUIT_OPEN)),
    autoroute: () => routeScope(input, { kind: "all" }),
    autorouteSelection: () => routeScope(input, selectionScope(input.design, input.selection.names)),
    autorouteNet: () => routeScope(input, netScope(input.highlight)),
    unroute: () => unroute(input),
    lock: () => lockSelection(input, true),
    unlock: () => lockSelection(input, false),
    history: () => input.workspace.openBottom("log"),
    keys: () => input.openDialog("keys"),
    about: () => input.openDialog("about"),
    addPage: () => pageCommand(input, "addPage"),
    renamePage: () => pageCommand(input, "renamePage"),
    deletePage: () => pageCommand(input, "deletePage"),
    themeLight: () => input.workspace.setTheme("light"),
    themeDark: () => input.workspace.setTheme("dark"),
    hoverLabels: input.workspace.toggleHoverLabels,
    pourSolid: () => input.workspace.setPourFill(POUR_FILL_COMMANDS.pourSolid),
    pourHatched: () => input.workspace.setPourFill(POUR_FILL_COMMANDS.pourHatched),
    pourOutline: () => input.workspace.setPourFill(POUR_FILL_COMMANDS.pourOutline),
    findSimilar: () => selectSimilar(input),
    placementTransfer: () => transferPlacement(input),
    flip: () => flipSelection(input),
    annotate: () => annotateDesignators(input),
    systemSettings: () => input.openDialog("system"),
    newCircuit: () => input.openDialog("newCircuit"),
    footprintManager: () => input.openDialog("footprints"),
    packages: openPackagesToLook,
    print: () => printDesign(input, false),
    exportPdf: () => printDesign(input, true),
    copy: () => copySelection(input),
    paste: () => pasteCopied(input, input.view === "schematic" ? input.page : undefined, input.view === "schematic" ? "sch" : "pcb"),
  }
  return (table as Partial<Record<CommandId, () => void>>)[command]
}

/** The keys the app answers itself, with or without a canvas; each one's action is also its command. */
const APP_KEYS = ["undo", "redo", "openFile", "selectAll", "find", "findSimilar", "placementTransfer", "flip", "copy", "paste"] as const satisfies readonly (KeyActionName & CommandId)[]
const isAppKey = (action: KeyActionName | undefined): action is (typeof APP_KEYS)[number] => (APP_KEYS as readonly string[]).includes(action ?? "")

/**
 * Ctrl+Z undoes, Ctrl+Y and Ctrl+Shift+Z redo, Ctrl+O goes to the Page tree, Ctrl+A selects every part (and on the
 * schematic every wire) and Ctrl+F opens Find, outside text fields (keyAction decides).
 */
function useAppKeys(runCommand: (command: CommandId) => void, view: View): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = keyAction(keyInput(event), { view })?.action
      if (!isAppKey(action)) return
      // Text selected on the page is the browser's to copy.
      if (action === "copy" && (window.getSelection()?.toString() ?? "") !== "") return
      event.preventDefault()
      runCommand(action)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [runCommand, view])
}

/** Returns the function the menu bar and toolbar call; it changes only when what the commands read changes. */
export function useAppCommands(input: Input): (command: CommandId) => void {
  const [waiting, setWaiting] = useState<{ command: CommandId; view: View } | null>(null)
  const { file, openImported, view, setView, selection, select, circuit, actions, pickLayers, pickFilter, sheetWires, sheetLabels, sheetDrawings, pcbCopper, copperRecords, openChecks, checkCounts, openFind, openDialog, design, page, openPage, highlight } = input
  // The workspace object is new on every render, but its functions are stable.
  const { run, openBottom, openPageTree, setTheme, toggleHoverLabels, setPourFill } = input.workspace
  // A command waiting for its view runs once that view's canvas has mounted and subscribed.
  useEffect(() => {
    if (!waiting || view !== waiting.view) return
    const id = window.setTimeout(() => {
      setWaiting(null)
      if (!send(waiting.command)) actions.notify(`The ${waiting.view === "pcb" ? "PCB" : "schematic"} is still building; try again in a moment.`)
    }, 0)
    return () => window.clearTimeout(id)
  }, [waiting, view, actions])
  const runCommand = useCallback(
    (command: CommandId) => {
      const own = appCommand({ file, openImported, view, setView, selection, select, circuit, actions, pickLayers, pickFilter, sheetWires, sheetLabels, sheetDrawings, pcbCopper, copperRecords, workspace: { run, openBottom, openPageTree, setTheme, toggleHoverLabels, setPourFill }, openChecks, checkCounts, openFind, openDialog, design, page, openPage, highlight }, command)
      if (own) return own()
      const only = commandView(command)
      if (only && view !== only) {
        setView(only)
        setWaiting({ command, view: only })
        return
      }
      if (!send(command)) actions.notify("Wait for the build to finish, then try again.")
    },
    [file, openImported, view, setView, selection, select, circuit, actions, pickLayers, pickFilter, sheetWires, sheetLabels, sheetDrawings, pcbCopper, copperRecords, run, openBottom, openPageTree, setTheme, toggleHoverLabels, setPourFill, openChecks, checkCounts, openFind, openDialog, design, page, openPage, highlight],
  )
  useAppKeys(runCommand, view)
  return runCommand
}
