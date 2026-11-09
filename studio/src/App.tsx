import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { hasToken, type CircuitData, type Design } from "./api"
import { NO_HIGHLIGHT, remapHighlight } from "./pcb/highlight"
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
import { useStudioData } from "./use-studio-data"
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

export function App() {
  const { message, notify, dismiss } = useToast()
  const [picked, select] = useState<Selection>(Selection.none)
  const selectOnly = useCallback((name: string) => select((current) => current.only(name)), [])
  const [tab, setTab] = useState<Tab>("pcb")
  const [dialog, setDialog] = useState<DialogName | null>(null)
  const workspace = useWorkspace(tab)
  const { setHighlight, openBottom } = workspace
  const onFile = useCallback(() => {
    select(Selection.none)
    setHighlight(NO_HIGHLIGHT)
  }, [setHighlight])
  const data = useStudioData(notify, onFile)
  const { file, setFile, build, circuit } = data
  usePruneSelection(circuit, select)
  const selection = useShownSelection(picked, circuit)
  const actions = useActions({ file, refresh: data.refresh, refreshParts: data.refreshParts, notify })
  const place = usePlace({ file, refresh: data.refresh, refreshParts: data.refreshParts, notify }, selectOnly)
  const openChecks = useCallback(() => openBottom("drc"), [openBottom])
  const checks = useChecks({ file, build, onTab: setTab, onSelect: selectOnly, onOpen: openChecks })
  useEscapeClearsSelection(select)
  useHighlightFollowsBuild(build.design, setHighlight)
  const closeDialog = useCallback(() => setDialog(null), [])
  const openDocument = useCallback(
    (target: string, view: DocView) => {
      setFile(target)
      setTab(view)
    },
    [setFile],
  )
  const runCommand = useAppCommands({ file, view: tab, setView: setTab, selection, select, circuit, actions, workspace, openChecks, openDialog: setDialog })

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
