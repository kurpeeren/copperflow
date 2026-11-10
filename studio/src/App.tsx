import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { api, hasToken, type CircuitData, type Design } from "./api"
import { tidyReason } from "./pcb/auto-placed"
import { isSheetFile } from "./pcb/sheet-names"
import { NO_HIGHLIGHT, remapHighlight } from "./pcb/highlight"
import { pickLayersOf } from "./pcb/layers"
import { copperBoxes } from "./pcb/copper-hit"
import { drawingAfterBuild, renamedAfterBuild, stableDrawings, type DrawingRename } from "./pcb/drawing-selection"
import { labelAfterBuild } from "./pcb/label-selection"
import { shownSelection, wireAfterBuild, withEndPins } from "./pcb/wire-selection"
import { boardTexts, sheetTexts } from "./pcb/part-text"
import { goneFrom, Selection, type SelectionChange } from "./selection"
import { BottomStrip } from "./shell/BottomStrip"
import { watchDpr } from "./shell/dpr"
import { StudioDialog, type DialogName } from "./shell/Dialogs"
import type { MakeSheetPreview } from "./shell/make-sheet-form"
import type { MakeSheetPanel } from "./shell/MakeSheetDialog"
import { MenuBar } from "./shell/MenuBar"
import type { CommandsOff } from "./shell/menus"
import type { DocView } from "./shell/page-tree"
import { designOnPage, MAIN_PAGE, shownPage } from "./shell/schematic-pages"
import { StatusPill } from "./shell/StatusPill"
import { themeToggles } from "./shell/theme-state"
import { Toolbar } from "./shell/ToolbarRow"
import { useAppCommands } from "./shell/use-app-commands"
import { Workspace } from "./shell/Workspace"
import { useActions, usePlace, type Actions } from "./use-actions"
import { useChecks } from "./use-checks"
import { useFind } from "./use-find"
import { useStudioData, type StudioData } from "./use-studio-data"
import { useWorkspace } from "./use-workspace"

export type { Actions } from "./use-actions"

type Tab = "pcb" | "schematic"

/** A message at the bottom of the window that goes after six seconds or a click. */
function useToast() {
  const [message, setMessage] = useState<string | null>(null)
  const notify = useCallback((text: string) => {
    setMessage(text)
    window.setTimeout(() => setMessage((current) => (current === text ? null : current)), 6000)
  }, [])
  const dismiss = useCallback(() => setMessage(null), [])
  return { message, notify, dismiss }
}

/** Esc clears the selection, outside text fields. */
function useEscapeClearsSelection(select: (change: SelectionChange) => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest("input, textarea, select")
      if (event.key === "Escape" && !typing) select((current) => current.clear())
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [select])
}

/**
 * Takes the parts that left the circuit (removed in the code, say) out of the selection when the circuit changes, so a
 * part that comes back (an undo) is not selected again. A part placed and not yet in a loaded circuit stays.
 */
function usePruneSelection(circuit: CircuitData | undefined, select: (change: SelectionChange) => void): void {
  const before = useRef<readonly string[]>([])
  useEffect(() => {
    if (!circuit) return
    const names = circuit.model.parts.map((part) => part.name)
    const gone = goneFrom(before.current, names)
    before.current = names
    if (gone.length > 0) select((current) => current.without(gone))
  }, [circuit, select])
}

/**
 * Drops the selected wires a rebuild took away or re-pointed (wire-selection.ts), so they are not selected again when
 * they come back, keeps the selected labels under their new ids (label-selection.ts), follows a renamed drawing to its
 * new id, and drops the drawings it took away or whose ids now name other drawings (drawing-selection.ts). Returns the
 * design it last saw (while a render shows a new design, that is still the one before it) and how to announce a rename.
 */
function usePruneWire(design: Design | undefined, select: (change: SelectionChange) => void) {
  const before = useRef<Design | undefined>(undefined)
  const renames = useRef<readonly DrawingRename[]>([])
  useEffect(() => {
    if (!design || design === before.current) return
    const previous = before.current
    before.current = design
    const drawings = design.schematic.drawings
    const waiting = renames.current
    renames.current = renamedAfterBuild(Selection.none, waiting, drawings).waiting
    select((current) => {
      const wires = current.wireCount === 0 ? current : wireAfterBuild(current, previous && withEndPins(previous.schematic), withEndPins(design.schematic))
      const renamed = renamedAfterBuild(labelAfterBuild(wires, previous, design), waiting, drawings).selection
      return drawingAfterBuild(renamed, previous?.schematic.drawings, drawings)
    })
  }, [design, select])
  const onRenameDrawing = useCallback((rename: DrawingRename) => {
    renames.current = [...renames.current, rename]
    return () => {
      renames.current = renames.current.filter((other) => other !== rename)
    }
  }, [])
  return { seen: before, onRenameDrawing }
}

/**
 * What the canvases and panels are shown (wire-selection.ts): no part the circuit lacks, no wire or label the open
 * sheet lacks, and no drawing whose id now names another one than in the design `before` (drawing-selection.ts), so a
 * new design is never drawn with a stale drawing selected while the pruning catches up.
 */
function useShownSelection(selection: Selection, circuit: CircuitData | undefined, design: Design | undefined, view: Tab, before: Design | undefined): Selection {
  return useMemo(() => {
    // On the PCB the parts sub-sheet instances make (R101) are picked too: they are on the board, not in the file.
    const flattened = view === "pcb" ? (design?.circuit.components.filter((c) => c.instance !== undefined).map((c) => c.id) ?? []) : []
    const parts = circuit && [...circuit.model.parts.map((part) => part.name), ...flattened]
    const sheet = design?.schematic
    const ids = <T extends { id: string }>(items: readonly T[] | undefined) => items?.map((item) => item.id)
    const drawings = sheet && stableDrawings(before?.schematic.drawings, sheet.drawings)
    const copper = design && [...design.pcb.tracks, ...design.pcb.vias].map((item) => item.id)
    const texts = design && ids(view === "pcb" ? boardTexts(design.pcb) : view === "schematic" ? sheetTexts(design.schematic) : [])
    return shownSelection(selection, { view, parts, wires: ids(sheet?.wires), labels: ids(sheet?.labels), drawings, copper, texts })
  }, [selection, circuit, design, view, before])
}

/** A rebuild can rename or merge the highlighted net (an unnamed net that gets GND): follow it, or clear it. */
function useHighlightFollowsBuild(design: Design | undefined, setHighlight: ReturnType<typeof useWorkspace>["setHighlight"]): void {
  const lastDesign = useRef<Design | undefined>(undefined)
  useEffect(() => {
    const before = lastDesign.current
    lastDesign.current = design
    if (design && design !== before) setHighlight((current) => remapHighlight(current, before, design))
  }, [design, setHighlight])
}

function NoToken() {
  return (
    <p className="empty">
      Open the address that <code>copperflow studio</code> printed in the terminal. It contains a key for this session.
    </p>
  )
}

/** The open file's data; opening another file drops the selection and the highlight. */
function useFileData(notify: (text: string) => void, select: (change: Selection) => void, setHighlight: WorkspaceState["setHighlight"]) {
  const onFile = useCallback(() => {
    select(Selection.none)
    setHighlight(NO_HIGHLIGHT)
  }, [select, setHighlight])
  return useStudioData(notify, onFile)
}

type WorkspaceState = ReturnType<typeof useWorkspace>

interface PanelsInput {
  data: StudioData
  tab: Tab
  setTab(tab: Tab): void
  select(change: SelectionChange): void
  selectOnly(name: string): void
  workspace: WorkspaceState
}

/** The DRC checks and Find: each selects parts, opens its bottom tab and can centre the camera on what it found. */
function useChecksAndFind({ data, tab, setTab, select, selectOnly, workspace }: PanelsInput) {
  const { file, build } = data
  const { setHighlight, openBottom } = workspace
  const openChecks = useCallback(() => openBottom("drc"), [openBottom])
  const selectCopper = useCallback((ids: readonly string[]) => select(() => Selection.none.all([], [], [], [], ids)), [select])
  const checks = useChecks({ file, build, onTab: setTab, onSelect: selectOnly, onSelectCopper: selectCopper, onOpen: openChecks })
  const openFindResults = useCallback(() => openBottom("find"), [openBottom])
  const find = useFind({ file, circuit: data.circuit, library: data.parts.library, design: build.design, view: tab, onSelect: select, onHighlight: setHighlight, requestFocus: checks.requestFocus, openResults: openFindResults })
  return { checks, find, openChecks }
}

/** Everything the window shows, wired together: the server's data, the selection, the panels, the checks and Find. */
function useStudio() {
  const toast = useToast()
  const [picked, select] = useState<Selection>(Selection.none)
  const selectOnly = useCallback((name: string) => select((current) => current.only(name)), [])
  const [tab, setTab] = useState<Tab>("pcb")
  const [dialog, setDialog] = useState<DialogName | null>(null)
  const workspace = useWorkspace(tab)
  const data = useFileData(toast.notify, select, workspace.setHighlight)
  const { file, setFile, build, circuit } = data
  usePruneSelection(circuit, select)
  const { seen, onRenameDrawing } = usePruneWire(build.design, select)
  const selection = useShownSelection(picked, circuit, build.design, tab, seen.current)
  const actions = useActions({ file, refresh: data.refresh, refreshParts: data.refreshParts, notify: toast.notify })
  const [wantedPage, setWantedPage] = useState(MAIN_PAGE)
  const page = shownPage(build.design, wantedPage)
  const place = usePlace({ file, refresh: data.refresh, refreshParts: data.refreshParts, notify: toast.notify }, selectOnly, tab === "schematic" ? page : MAIN_PAGE)
  const { checks, find, openChecks } = useChecksAndFind({ data, tab, setTab, select, selectOnly, workspace })
  useEscapeClearsSelection(select)
  useHighlightFollowsBuild(build.design, workspace.setHighlight)
  const closeDialog = useCallback(() => setDialog(null), [])
  const [sheetParent, setSheetParent] = useState<SheetParent>()
  const openDocument = useCallback(
    (target: string, view: DocView, toPage?: string) => {
      if (toPage !== undefined) setWantedPage(toPage)
      else if (target !== file) setWantedPage(MAIN_PAGE)
      // A sheet opened from a circuit remembers it, so its tabs lead back and Properties counts its instances there.
      if (isSheetFile(target)) setSheetParent((current) => (file && !isSheetFile(file) ? { file, design: build.design } : current))
      else setSheetParent(undefined)
      setFile(target)
      setTab(isSheetFile(target) ? "schematic" : view)
    },
    [setFile, file, build.design],
  )
  const openSheet = useCallback((sheet: string) => openDocument(sheet, "schematic"), [openDocument])
  const openPage = useCallback((toPage: string) => {
    setWantedPage(toPage)
    setTab("schematic")
  }, [])
  const pcb = build.design?.pcb
  const pickLayers = useMemo(() => (tab === "pcb" && pcb ? pickLayersOf(pcb.parts, workspace.layerVisibility) : undefined), [tab, pcb, workspace.layerVisibility])
  const sheet = useMemo(() => (build.design ? designOnPage(build.design, page).schematic : undefined), [build.design, page])
  const sheetWires = useMemo(() => (tab === "schematic" && sheet ? sheet.wires.map((wire) => wire.id) : []), [tab, sheet])
  const sheetLabels = useMemo(() => (tab === "schematic" && sheet ? sheet.labels.map((label) => label.id) : []), [tab, sheet])
  const sheetDrawings = useMemo(() => (tab === "schematic" && sheet ? sheet.drawings.map((drawing) => drawing.id) : []), [tab, sheet])
  const pcbCopper = useMemo(() => (tab === "pcb" && pcb ? copperBoxes(pcb, workspace.layerVisibility).map(({ kind, id }) => ({ kind, id })) : []), [tab, pcb, workspace.layerVisibility])
  const copperRecords = tab === "pcb" ? pcb : undefined
  const sheetIds = { sheetWires, sheetLabels, sheetDrawings, pcbCopper, copperRecords }
  const runCommand = useAppCommands({ file, view: tab, setView: setTab, selection, select, circuit, actions, pickLayers, pickFilter: workspace.pickFilter, ...sheetIds, workspace, openChecks, openFind: find.open, openDialog: setDialog, design: build.design, page, openPage })
  return { toast, tab, setTab, dialog, closeDialog, workspace, data, selection, select, onRenameDrawing, actions, place, checks, find, openChecks, openDocument, openSheet, sheetParent, runCommand, page, openPage }
}

/** The circuit a sheet file was opened from, and its design as it was then. */
export interface SheetParent {
  file: string
  design: Design | undefined
}

/** The menu commands the build turns off for now, with the reason: Tidy sheet while Studio placed nothing on the sheet. */
function useCommandsOff(design: Design | undefined): CommandsOff {
  return useMemo(() => {
    const reason = tidyReason(design)
    return reason === null ? {} : { tidySheet: reason }
  }, [design])
}

/** What Edit → Make sub-sheet's dialog asks: previews of the open file's selected parts, and the change itself. */
function useMakeSheetPanel(file: string | undefined, parts: readonly string[], actions: Actions): MakeSheetPanel {
  return useMemo(
    () => ({
      parts,
      preview: (name: string, rename: boolean) => api<MakeSheetPreview>("/api/make-sheet", { file, name, parts, rename, preview: true }),
      make: (name: string, rename: boolean) => actions.makeSheet({ name, parts, rename }),
    }),
    [file, parts, actions],
  )
}

export function App() {
  const { toast, tab, setTab, dialog, closeDialog, workspace, data, selection, select, onRenameDrawing, actions, place, checks, find, openChecks, openDocument, openSheet, sheetParent, runCommand, page, openPage } = useStudio()
  const { build, circuit } = data
  const { message, dismiss } = toast
  const toggles = { snap: workspace.snap, ...themeToggles(workspace.theme) }
  const off = useCommandsOff(build.design)
  const makeSheet = useMakeSheetPanel(data.file, selection.names, actions)
  // Hairlines stay one device pixel through zoom and display-scale changes.
  useEffect(() => watchDpr(window), [])
  if (!hasToken) return <NoToken />
  return (
    <div className="app">
      <MenuBar run={runCommand} view={tab} selected={selection.size} toggles={toggles} off={off}>
        <StatusPill build={build} errors={checks.counts.errors} onOpen={openChecks} />
      </MenuBar>
      <Toolbar view={tab} unit={workspace.unit} selected={selection.size} toggles={toggles} run={runCommand} />
      {dialog && <StudioDialog name={dialog} onClose={closeDialog} rules={{ fabrication: build.design?.rules.fabrication, save: actions.setFilletRadius }} makeSheet={makeSheet} />}
      {circuit && circuit.violations.length > 0 && (
        <div className="banner" role="alert">
          Locked parts changed outside the editor: {circuit.violations.map((v) => `${v.part} (${v.detail})`).join(", ")}. Lock them again to accept the change, or undo it in the code.
        </div>
      )}
      <Workspace
        data={data}
        workspace={workspace}
        checks={checks}
        find={find}
        view={tab}
        onView={setTab}
        page={page}
        onPage={openPage}
        selection={selection}
        onSelect={select}
        onRenameDrawing={onRenameDrawing}
        actions={actions}
        run={runCommand}
        onPlace={place}
        onOpenDocument={openDocument}
        onOpenSheet={openSheet}
        sheetParent={sheetParent}
        openChecks={openChecks}
      />
      <BottomStrip state={workspace.bottom} onClick={workspace.clickBottomTab} onOpen={workspace.openBottom} />
      {message && (
        <div className="toast" role="status" onClick={dismiss}>
          {message}
        </div>
      )}
    </div>
  )
}
