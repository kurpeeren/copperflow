import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { hasToken, type CircuitData, type Design } from "./api"
import { NO_HIGHLIGHT, remapHighlight } from "./pcb/highlight"
import { pickLayersOf } from "./pcb/layers"
import { goneFrom, Selection, type SelectionChange } from "./selection"
import { BottomStrip } from "./shell/BottomStrip"
import { StudioDialog, type DialogName } from "./shell/Dialogs"
import { MenuBar } from "./shell/MenuBar"
import type { DocView } from "./shell/page-tree"
import { StatusPill } from "./shell/StatusPill"
import { Toolbar } from "./shell/ToolbarRow"
import { useAppCommands } from "./shell/use-app-commands"
import { Workspace } from "./shell/Workspace"
import { useActions, usePlace } from "./use-actions"
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

/** What the canvases and panels are shown: the selection less any part the loaded circuit does not have (yet). */
function useShownSelection(selection: Selection, circuit: CircuitData | undefined): Selection {
  return useMemo(() => (circuit ? selection.keep(circuit.model.parts.map((part) => part.name)) : selection), [selection, circuit])
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
  const checks = useChecks({ file, build, onTab: setTab, onSelect: selectOnly, onOpen: openChecks })
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
  const selection = useShownSelection(picked, circuit)
  const actions = useActions({ file, refresh: data.refresh, refreshParts: data.refreshParts, notify: toast.notify })
  const place = usePlace({ file, refresh: data.refresh, refreshParts: data.refreshParts, notify: toast.notify }, selectOnly)
  const { checks, find, openChecks } = useChecksAndFind({ data, tab, setTab, select, selectOnly, workspace })
  useEscapeClearsSelection(select)
  useHighlightFollowsBuild(build.design, workspace.setHighlight)
  const closeDialog = useCallback(() => setDialog(null), [])
  const openDocument = useCallback(
    (target: string, view: DocView) => {
      setFile(target)
      setTab(view)
    },
    [setFile],
  )
  const pcb = build.design?.pcb
  const pickLayers = useMemo(() => (tab === "pcb" && pcb ? pickLayersOf(pcb.parts, workspace.layerVisibility) : undefined), [tab, pcb, workspace.layerVisibility])
  const runCommand = useAppCommands({ file, view: tab, setView: setTab, selection, select, circuit, actions, pickLayers, pickFilter: workspace.pickFilter, workspace, openChecks, openFind: find.open, openDialog: setDialog })
  return { toast, tab, setTab, dialog, closeDialog, workspace, data, selection, select, actions, place, checks, find, openChecks, openDocument, runCommand }
}

export function App() {
  const { toast, tab, setTab, dialog, closeDialog, workspace, data, selection, select, actions, place, checks, find, openChecks, openDocument, runCommand } = useStudio()
  const { build, circuit } = data
  const { message, dismiss } = toast
  if (!hasToken) return <NoToken />
  return (
    <div className="app">
      <MenuBar run={runCommand} view={tab}>
        <StatusPill build={build} errors={checks.counts.errors} onOpen={openChecks} />
      </MenuBar>
      <Toolbar view={tab} unit={workspace.unit} run={runCommand} />
      {dialog && <StudioDialog name={dialog} onClose={closeDialog} />}
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
        selection={selection}
        onSelect={select}
        actions={actions}
        run={runCommand}
        onPlace={place}
        onOpenDocument={openDocument}
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
