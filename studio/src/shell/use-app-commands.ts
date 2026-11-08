// What a menu or toolbar command does: the app's own commands run here, the rest go to the open canvas over the
// command bus. Schematic-only commands sent while the PCB is open switch to the schematic first.
import { useCallback, useEffect, useState } from "react"
import { api, type BomLine } from "../api"
import { bomCsv, bomFileName } from "./bom-csv"
import type { Actions } from "../App"
import { keyAction, keyInput, type KeyActionName } from "../pcb/canvas-keys"
import type { View } from "../pcb/positions"
import type { BottomTab } from "./bottom-state"
import { send } from "./commands"
import type { DialogName } from "./Dialogs"
import type { CommandId } from "./menus"

/** Commands only the schematic canvas answers. */
const SCHEMATIC_ONLY: ReadonlySet<CommandId> = new Set(["wire", "netLabel", "groundFlag", "powerFlag"])

/** Commands the workspace runs as it runs their keys. */
const WORKSPACE: Partial<Record<CommandId, KeyActionName>> = {
  toggleUnit: "toggleUnit",
  toggleLeftPanel: "toggleLeftPanel",
  toggleRightPanel: "toggleRightPanel",
  toggleBottomPanel: "toggleBottomPanel",
  clearHighlight: "clearHighlight",
  placeComponent: "openLibrary",
}

interface Input {
  file: string | undefined
  view: View
  setView(view: View): void
  selected: string | null
  actions: Actions
  workspace: { run(action: KeyActionName): void; openBottom(tab: BottomTab): void }
  openChecks(): void
  openDialog(name: DialogName): void
}

function exportPackage(file: string | undefined, actions: Actions): void {
  if (!file) return
  actions.notify("Exporting the BOM and datasheets…")
  api<{ outDir: string; files: string[] }>("/api/package", { file })
    .then((result) => actions.notify(`Exported ${result.files.length} files to ${result.outDir}`))
    .catch((error: Error) => actions.notify(error.message))
}

/** Saves the BOM as a CSV file through the browser's download. */
function exportBom(file: string | undefined, actions: Actions): void {
  if (!file) return
  api<BomLine[]>(`/api/bom?file=${encodeURIComponent(file)}`)
    .then((lines) => {
      const url = URL.createObjectURL(new Blob([bomCsv(lines)], { type: "text/csv" }))
      const link = Object.assign(document.createElement("a"), { href: url, download: bomFileName(file) })
      link.click()
      URL.revokeObjectURL(url)
      actions.notify(`Saved ${bomFileName(file)}`)
    })
    .catch((error: Error) => actions.notify(error.message))
}

function lockSelected(input: Input, locked: boolean): void {
  if (!input.selected) return input.actions.notify("Select a part first.")
  void input.actions.lock([input.selected], locked)
}

/** The app's own commands; undefined for the ones the canvases answer. */
function appCommand(input: Input, command: CommandId): (() => void) | undefined {
  const action = WORKSPACE[command]
  if (action) return () => input.workspace.run(action)
  const table: Partial<Record<CommandId, () => void>> = {
    openFile: () => document.querySelector<HTMLSelectElement>("select[aria-label='Circuit file']")?.focus(),
    exportBom: () => exportBom(input.file, input.actions),
    exportPackage: () => exportPackage(input.file, input.actions),
    undo: () => void input.actions.undo(),
    checkDrc: input.openChecks,
    lock: () => lockSelected(input, true),
    unlock: () => lockSelected(input, false),
    history: () => input.workspace.openBottom("log"),
    keys: () => input.openDialog("keys"),
    about: () => input.openDialog("about"),
  }
  return table[command]
}

/** Ctrl+Z undoes and Ctrl+O goes to the file list, outside text fields (keyAction decides). */
function useAppKeys(runCommand: (command: CommandId) => void, view: View): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const hit = keyAction(keyInput(event), { view })
      if (hit?.action !== "undo" && hit?.action !== "openFile") return
      event.preventDefault()
      runCommand(hit.action)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [runCommand, view])
}

/** Returns the function the menu bar and toolbar call. */
export function useAppCommands(input: Input): (command: CommandId) => void {
  const [waiting, setWaiting] = useState<CommandId | null>(null)
  const { file, view, setView, selected, actions, openChecks, openDialog } = input
  // The workspace object is new on every render, but these two functions are stable.
  const { run, openBottom } = input.workspace
  // A command waiting for the schematic runs once the schematic canvas has mounted and subscribed.
  useEffect(() => {
    if (!waiting || view !== "schematic") return
    const id = window.setTimeout(() => {
      setWaiting(null)
      if (!send(waiting)) actions.notify("The schematic is still building; try again in a moment.")
    }, 0)
    return () => window.clearTimeout(id)
  }, [waiting, view, actions])
  const runCommand = useCallback(
    (command: CommandId) => {
      const own = appCommand({ file, view, setView, selected, actions, workspace: { run, openBottom }, openChecks, openDialog }, command)
      if (own) return own()
      if (SCHEMATIC_ONLY.has(command) && view !== "schematic") {
        setView("schematic")
        setWaiting(command)
        return
      }
      if (!send(command)) actions.notify("Wait for the build to finish, then try again.")
    },
    [file, view, setView, selected, actions, run, openBottom, openChecks, openDialog],
  )
  useAppKeys(runCommand, view)
  return runCommand
}
