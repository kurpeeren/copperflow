import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
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
import { PackagesDialog, StudioDialog, VerifyDialog, type DialogName, type ExportChecksPanel } from "./shell/Dialogs"
import { packagesRequests } from "./shell/packages-request"
import { useVerifyPanel } from "./shell/verify-panel"
import { importSummary, type ImportPartRequest, type ImportPartResult } from "./shell/import-part-form"
import type { ImportPartPanel } from "./shell/ImportPartDialog"
import { createdSummary, type CreatePartRequest, type CreatePartResult } from "./shell/new-part-result"
import type { NewPartPanel } from "./shell/new-part-result"
import type { NewCircuitPanel } from "./shell/NewCircuitDialog"
import type { FootprintPanel } from "./shell/FootprintManagerDialog"
import type { NewCircuitRequest } from "./shell/new-circuit-form"
import type { MakeSheetPreview } from "./shell/make-sheet-form"
import type { MakeSheetChoice, MakeSheetPanel } from "./shell/MakeSheetDialog"
import { MenuBar } from "./shell/MenuBar"
import type { CommandsOff } from "./shell/menus"
import type { DocView } from "./shell/page-tree"
import { designOnPage, MAIN_PAGE, shownPage } from "./shell/schematic-pages"
import { StatusPill } from "./shell/StatusPill"
import { themeToggles } from "./shell/theme-state"
import { pourFillToggles } from "./pcb/pour-view"
import { Toolbar } from "./shell/ToolbarRow"
import { useAppCommands, writeFabricationFiles } from "./shell/use-app-commands"
import { Workspace } from "./shell/Workspace"
import { useActions, usePlace, type Actions } from "./use-actions"
import { useChecks } from "./use-checks"
import { useFind } from "./use-find"
import { useStudioData, type StudioData } from "./use-studio-data"
import { SERVER_GONE_MESSAGE } from "./request-error"
import { blocksCommand, lockedOff } from "./ai-lock"
import type { CommandId } from "./shell/menus"
import { lockGate } from "./ai-lock-gate"
import { useChangeView } from "./change-store"
import { CHANGE_VIEW_MESSAGE, changeOff } from "./change-view"
import { useAiLock } from "./use-ai-lock"
import { AiLockButton } from "./shell/AiLockButton"
import { exportChecksQuestion } from "./shell/fabrication-note"
import type { CheckCounts } from "../../src/core/checks-line.js"
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
    const board = design && [...(design.pcb.board?.pours ?? []), ...(design.pcb.holes ?? [])].map((item) => item.id)
    const texts = design && ids(view === "pcb" ? boardTexts(design.pcb) : view === "schematic" ? sheetTexts(design.schematic) : [])
    return shownSelection(selection, { view, parts, wires: ids(sheet?.wires), labels: ids(sheet?.labels), drawings, copper, texts, board })
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
  const selectCopper = useCallback((ids: readonly string[], board: readonly string[]) => select(() => Selection.none.all([], [], [], [], ids).addBoard(board)), [select])
  const checks = useChecks({ file, build, route: data.route, onTab: setTab, onSelect: selectOnly, onSelectCopper: selectCopper, onOpen: openChecks })
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
  // The part whose Verify screen is open, opened from the Library table or the inspector.
  const [verifying, setVerifying] = useState<{ id: string; title: string }>()
  const openVerify = useCallback((id: string, title: string) => setVerifying({ id, title }), [])
  const closeVerify = useCallback(() => setVerifying(undefined), [])
  const workspace = useWorkspace(tab)
  const data = useFileData(toast.notify, select, workspace.setHighlight)
  const { file, setFile, build, circuit } = data
  usePruneSelection(circuit, select)
  const { seen, onRenameDrawing } = usePruneWire(build.design, select)
  const selection = useShownSelection(picked, circuit, build.design, tab, seen.current)
  const actions = useActions({ file, refresh: data.refresh, notify: toast.notify, openVerify })
  const [wantedPage, setWantedPage] = useState(MAIN_PAGE)
  const page = shownPage(build.design, wantedPage)
  const place = usePlace({ file, refresh: data.refresh, notify: toast.notify }, selectOnly, tab === "schematic" ? page : MAIN_PAGE)
  const { checks, find, openChecks } = useChecksAndFind({ data, tab, setTab, select, selectOnly, workspace })
  useEscapeClearsSelection(select)
  useHighlightFollowsBuild(build.design, workspace.setHighlight)
  const closeDialog = useCallback(() => setDialog(null), [])
  const openImportPart = useCallback(() => setDialog("importPart"), [])
  const openNewPart = useCallback(() => setDialog("newPart"), [])
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
  const aiLock = useAiLock(data.history, circuit !== undefined, tab, toast.notify)
  const openImported = useCallback((made: string) => void data.refreshFiles().then(() => openDocument(made, "pcb")), [data, openDocument])
  const runAny = useAppCommands({ file, openImported, view: tab, setView: setTab, selection, select, circuit, actions, pickLayers, pickFilter: workspace.pickFilter, ...sheetIds, workspace, openChecks, checkCounts: checks.counts, openFind: find.open, openDialog: setDialog, design: build.design, page, openPage, highlight: workspace.highlight })
  // Every menu, toolbar and context menu command comes through here: while the AI lock is closed no editing one runs.
  // While a change is shown the board cannot be edited either; the command says why.
  const changeShown = useChangeView() !== undefined
  const runCommand = useCallback(
    (command: CommandId) => (changeShown && blocksCommand(command) ? toast.notify(CHANGE_VIEW_MESSAGE) : aiLock.closed && blocksCommand(command) ? void lockGate.refuses() : runAny(command)),
    [aiLock.closed, changeShown, runAny, toast.notify],
  )
  return { verifying, closeVerify, aiLock, toast, tab, setTab, dialog, closeDialog, openImportPart, openNewPart, workspace, data, selection, select, onRenameDrawing, actions, place, checks, find, openChecks, openDocument, openSheet, sheetParent, runCommand, page, openPage }
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

/** What Library → Import by LCSC number… asks: the import itself; the Library then reads the parts again. */
function useImportPartPanel(refreshParts: () => Promise<void>, notify: (message: string) => void): ImportPartPanel {
  return useMemo(
    () => ({
      import: async (request: ImportPartRequest) => {
        const result = await api<ImportPartResult>("/api/import-part", request)
        await refreshParts()
        notify(importSummary(result))
        return result
      },
    }),
    [refreshParts, notify],
  )
}

/** What Library → New part… asks: the part written from the datasheet; the Library then reads the parts again. */
function useNewPartPanel(refreshParts: () => Promise<void>, notify: (message: string) => void): NewPartPanel {
  return useMemo(
    () => ({
      create: async (request: CreatePartRequest) => {
        const result = await api<CreatePartResult>("/api/create-part", request)
        await refreshParts()
        notify(createdSummary(result))
        return result
      },
    }),
    [refreshParts, notify],
  )
}

/** What File → New circuit… asks: the empty circuit written through the core, then the file list read again and the file opened. */
function useNewCircuitPanel(refreshFiles: () => Promise<void>, open: (file: string, view: DocView) => void, notify: (message: string) => void): NewCircuitPanel {
  return useMemo(
    () => ({
      create: async (request: NewCircuitRequest) => {
        try {
          const made = await api<{ file: string }>("/api/new-circuit", request)
          await refreshFiles()
          open(made.file, "schematic")
          notify(`Created ${made.file}; Undo removes it again`)
          return true
        } catch (error) {
          notify((error as Error).message)
          return false
        }
      },
    }),
    [refreshFiles, open, notify],
  )
}

/** What Tools → Footprint manager… reads: the open design's parts and their locks; it writes through the actions' edit. */
function useFootprintPanel(design: Design | undefined, circuit: CircuitData | undefined, actions: Actions): FootprintPanel {
  return useMemo(() => {
    const locked = new Set(circuit?.annotations.locks.filter((lock) => !lock.drawing).map((lock) => lock.part))
    const source = design && circuit ? { components: design.circuit.components, parts: circuit.model.parts, locked } : undefined
    return { source, write: actions.edit }
  }, [design, circuit, actions])
}

/** What Export → Fabrication files asks when the checks report errors: Show checks opens the DRC tab, Export anyway writes. */
function useExportChecksPanel(file: string | undefined, counts: CheckCounts, openChecks: () => void, actions: Actions): ExportChecksPanel {
  return useMemo(() => ({ question: exportChecksQuestion(counts), showChecks: openChecks, exportAnyway: () => writeFabricationFiles(file, actions) }), [file, counts, openChecks, actions])
}

/** What Edit → Make sub-sheet's dialog asks: previews of the open file's selected parts, and the change itself. */
function useMakeSheetPanel(file: string | undefined, parts: readonly string[], actions: Actions): MakeSheetPanel {
  return useMemo(
    () => ({
      parts,
      preview: (choice: MakeSheetChoice) => api<MakeSheetPreview>("/api/make-sheet", { file, parts, ...choice, preview: true }),
      make: (choice: MakeSheetChoice) => actions.makeSheet({ parts, ...choice }),
    }),
    [file, parts, actions],
  )
}

export function App() {
  const { verifying, closeVerify, aiLock, toast, tab, setTab, dialog, closeDialog, openImportPart, openNewPart, workspace, data, selection, select, onRenameDrawing, actions, place, checks, find, openChecks, openDocument, openSheet, sheetParent, runCommand, page, openPage } = useStudio()
  const { build, circuit } = data
  const { message, dismiss } = toast
  const toggles = { snap: workspace.snap, hoverLabels: workspace.hoverLabels, ...themeToggles(workspace.theme), ...pourFillToggles(workspace.pourFill) }
  const designOff = useCommandsOff(build.design)
  const changeShown = useChangeView() !== undefined
  const off = useMemo(() => ({ ...designOff, ...lockedOff(aiLock.closed), ...changeOff(changeShown) }), [designOff, aiLock.closed, changeShown])
  const makeSheet = useMakeSheetPanel(data.file, selection.names, actions)
  const importPart = useImportPartPanel(data.refreshParts, toast.notify)
  const newPart = useNewPartPanel(data.refreshParts, toast.notify)
  const verifyPanel = useVerifyPanel(data.refreshParts)
  const newCircuit = useNewCircuitPanel(data.refreshFiles, openDocument, toast.notify)
  const footprints = useFootprintPanel(build.design, circuit, actions)
  const exportChecks = useExportChecksPanel(data.file, checks.counts, openChecks, actions)
  const packages = useSyncExternalStore(packagesRequests.subscribe, packagesRequests.current)
  const system = { settings: { theme: workspace.theme, unit: workspace.unit, grid: workspace.gridSteps, hoverLabels: workspace.hoverLabels }, apply: workspace.applySystem }
  // Hairlines stay one device pixel through zoom and display-scale changes.
  useEffect(() => watchDpr(window), [])
  if (!hasToken) return <NoToken />
  return (
    <div className="app">
      <MenuBar run={runCommand} view={tab} selected={selection.size} toggles={toggles} off={off}>
        <StatusPill build={build} errors={checks.counts.errors} onOpen={openChecks} />
      </MenuBar>
      <Toolbar view={tab} unit={workspace.unit} selected={selection.size} toggles={toggles} off={off} run={runCommand} />
      {dialog && <StudioDialog name={dialog} onClose={closeDialog} rules={{ fabrication: build.design?.rules.fabrication, save: actions.setFilletRadius }} makeSheet={makeSheet} importPart={importPart} newPart={newPart} system={system} newCircuit={newCircuit} footprints={footprints} exportChecks={exportChecks} />}
      {packages && <PackagesDialog request={packages} onClose={packagesRequests.close} />}
      {verifying && <VerifyDialog target={verifying} panel={verifyPanel} onClose={closeVerify} />}
      {data.serverGone && (
        <div className="banner" role="alert">
          {SERVER_GONE_MESSAGE}
        </div>
      )}
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
        onImportPart={openImportPart}
        onNewPart={openNewPart}
        onOpenDocument={openDocument}
        onOpenSheet={openSheet}
        sheetParent={sheetParent}
        openChecks={openChecks}
        aiLocked={aiLock.closed}
        lockControl={<AiLockButton closed={aiLock.closed} onToggle={aiLock.toggle} />}
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
