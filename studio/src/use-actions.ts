// The edits Studio sends to its server. Each one reports a failure itself, then reloads the open file.
import { useCallback, useMemo } from "react"
import type { LayoutEdit } from "../../src/core/layout-records.js"
import { api, type Edit, type PlaceScope, type RouteScope } from "./api"
import { announceHistoryWrite } from "./history-writes"
import { noteRulesWrite } from "./pcb/rules-writes"
import { PLACE_DEFAULTS } from "./place-defaults"
import { madeNote, type MakeSheetPreview } from "./shell/make-sheet-form"

/** Every action reports failures itself and resolves to whether it succeeded. */
export interface Actions {
  edit(edits: Edit[], summary: string): Promise<boolean>
  /** Like edit, and also gives the server's mark of the write, which orders it against builds (LiveProject.nextMark). */
  editMarked(edits: Edit[], summary: string): Promise<EditOutcome>
  /**
   * Edits another file than the open one, as one history entry naming it: a sheet file, from its symbol on the parent
   * page or from Replicate layout. The open file's build follows, since it reads that file.
   */
  editFile(file: string, edits: Edit[], summary: string): Promise<EditOutcome>
  /** Writes copper edits to the open circuit's layout file, as one history entry, with the mark of the write. */
  editLayout(edits: LayoutEdit[], summary: string, sheet?: { file: string; edits: Edit[] }): Promise<EditOutcome>
  lock(parts: string[], locked: boolean): Promise<boolean>
  mark(text: string, at?: { view: "pcb" | "schematic"; x: number; y: number }): Promise<boolean>
  unmark(id: string): Promise<boolean>
  /** Undoes the newest change, or the named one; the open canvas's keys wait for the build that reads it (history-writes.ts). */
  undo(id?: string): Promise<EditOutcome>
  /** Redoes the newest undone change, or the named one, announced as undo is. */
  redo(id?: string): Promise<EditOutcome>
  /** Opens the Verify screen of a library part; only the person verifies, there. */
  openVerify(id: string, title: string): void
  /** Design → Annotate designators: parts renamed, and the layout file's nets with them, as one history entry. */
  renameParts(mapping: readonly { from: string; to: string }[], summary: string): Promise<EditOutcome>
  /** Edit → Make sub-sheet: the parts moved into a new sheet file and an instance in their place, as one history entry. */
  makeSheet(request: { name: string; parts: readonly string[]; rename: boolean; instance?: string }): Promise<boolean>
  /** Route → Autoroute: starts routing the open circuit's board in the scope; its news comes as route events. */
  route(scope: RouteScope): Promise<boolean>
  /** Cancels the run going now. */
  cancelRoute(): Promise<boolean>
  /** Place → Autoplace: starts placing the open circuit's board in the scope; its news comes as place events. */
  autoplace(scope: PlaceScope): Promise<boolean>
  cancelAutoplace(): Promise<boolean>
  /** Layout → Fit board: the board reshaped round the parts, as one history entry, and told. */
  fitBoard(): Promise<EditOutcome>
  /** File → Import board outline (DXF): the picked drawing's board written to the open circuit, as one history entry, and told. */
  importBoard(name: string, text: string): Promise<EditOutcome>
  /** File → Import board with a KiCad board: a new circuit written as one history entry; its file, or undefined when refused. */
  importKicad(name: string, text: string): Promise<string | undefined>
  /** Route → Unroute: removes the router's copper among `ids`, or all of it, as one history entry, and tells it. */
  unroute(ids?: readonly string[]): Promise<EditOutcome>
  /** Design rules: writes the fillet radius to rules.yaml (null for the default), as one history entry, and tells it. */
  setFilletRadius(radius: number | null): Promise<boolean>
  notify(text: string): void
}

/** Whether an edit went through, and the mark the server took when it wrote it. */
export interface EditOutcome {
  ok: boolean
  mark?: number
}

interface ActionsInput {
  file: string | undefined
  refresh(file: string): Promise<void>
  notify(text: string): void
  openVerify(id: string, title: string): void
}

/** Memoised, so panels can depend on the actions in effects without refetching on every render. */
export function useActions({ file, refresh, notify, openVerify }: ActionsInput): Actions {
  const run = useCallback(
    async (task: () => Promise<unknown>): Promise<boolean> => {
      try {
        await task()
        return true
      } catch (error) {
        notify((error as Error).message)
        return false
      } finally {
        if (file) await refresh(file).catch(() => undefined)
      }
    },
    [file, refresh, notify],
  )
  /** Posts a request that writes the circuit file, and gives the server's mark of the write with the outcome. */
  const postMarked = useCallback(
    async (path: string, body: unknown): Promise<EditOutcome> => {
      let mark: number | undefined
      const ok = await run(async () => {
        mark = (await api<{ writeMark?: number }>(path, body)).writeMark
      })
      return { ok, mark }
    },
    [run],
  )
  const editMarked = useCallback((edits: Edit[], summary: string) => postMarked("/api/edit", { file, edits, summary }), [file, postMarked])
  const editLayout = useCallback(
    (edits: LayoutEdit[], summary: string, sheet?: { file: string; edits: Edit[] }) => postMarked("/api/layout", { file, edits, summary, ...(sheet ? { sheet } : {}) }),
    [file, postMarked],
  )
  return useMemo(
    () => ({
      edit: async (edits, summary) => (await editMarked(edits, summary)).ok,
      editMarked,
      editFile: (target, edits, summary) => postMarked("/api/edit", { file: target, edits, summary }),
      editLayout,
      renameParts: (mapping, summary) => announceHistoryWrite(postMarked("/api/rename-parts", { file, mapping, summary })),
      lock: (parts, locked) => run(() => api("/api/lock", { file, parts, locked })),
      mark: (text, at) => run(() => api("/api/mark", { file, text, ...at })),
      unmark: (id) => run(() => api("/api/unmark", { file, id })),
      undo: (id) => announceHistoryWrite(postMarked("/api/undo", id ? { id } : {})),
      redo: (id) => announceHistoryWrite(postMarked("/api/redo", id ? { id } : {})),
      openVerify,
      makeSheet: (request) =>
        run(async () => {
          const made = await api<{ preview: MakeSheetPreview }>("/api/make-sheet", { file, ...request })
          notify(madeNote(made.preview, request.parts.length))
        }),
      route: async (scope) => {
        try {
          await api("/api/route", { file, scope })
          return true
        } catch (error) {
          notify((error as Error).message)
          return false
        }
      },
      cancelRoute: async () => {
        try {
          return (await api<{ cancelled: boolean }>("/api/route/cancel", {})).cancelled
        } catch (error) {
          notify((error as Error).message)
          return false
        }
      },
      autoplace: async (scope) => {
        try {
          await api("/api/autoplace", { file, scope })
          return true
        } catch (error) {
          notify((error as Error).message)
          return false
        }
      },
      cancelAutoplace: async () => {
        try {
          return (await api<{ cancelled: boolean }>("/api/autoplace/cancel", {})).cancelled
        } catch (error) {
          notify((error as Error).message)
          return false
        }
      },
      fitBoard: () =>
        announceHistoryWrite(
          (async () => {
            let mark: number | undefined
            const ok = await run(async () => {
              const done = await api<{ summary: string; writeMark: number }>("/api/fit-board", { file })
              mark = done.writeMark
              notify(done.summary)
            })
            return { ok, mark }
          })(),
        ),
      importBoard: (name, text) =>
        announceHistoryWrite(
          (async () => {
            let mark: number | undefined
            const ok = await run(async () => {
              const done = await api<{ summary: string; writeMark: number }>("/api/import-board", { file, name, text })
              mark = done.writeMark
              notify(done.summary)
            })
            return { ok, mark }
          })(),
        ),
      importKicad: async (name, text) => {
        let made: string | undefined
        await run(async () => {
          const done = await api<{ summary: string; file: string }>("/api/import-board", { file: file ?? "", name, text })
          made = done.file
          notify(done.summary)
        })
        return made
      },
      unroute: (ids) =>
        announceHistoryWrite(
          (async () => {
            let mark: number | undefined
            const ok = await run(async () => {
              const done = await api<{ summary: string; writeMark: number }>("/api/unroute", { file, ...(ids ? { ids } : {}) })
              mark = done.writeMark
              notify(done.summary)
            })
            return { ok, mark }
          })(),
        ),
      setFilletRadius: (radius) =>
        run(async () => {
          const saved = await api<{ summary: string; writeMark?: number }>("/api/rules", { filletRadius: radius, ...(file ? { file } : {}) })
          if (saved.writeMark !== undefined) noteRulesWrite({ radius, mark: saved.writeMark })
          notify(saved.summary)
        }),
      notify,
    }),
    [file, run, notify, editMarked, editLayout, postMarked, openVerify],
  )
}

/** Places a built-in or library part with its starting values and selects it. */
export function usePlace({ file, refresh, notify }: Omit<ActionsInput, "openVerify">, onPlaced: (name: string) => void, page = "Main"): (part: string) => void {
  return useCallback(
    (part: string) => {
      const props = PLACE_DEFAULTS[part]
      api<{ name: string }>("/api/place", { file, part, ...(props ? { props } : {}), ...(page === "Main" ? {} : { page }) })
        .then((result) => {
          onPlaced(result.name)
          notify(`Placed ${result.name}${props ? " with a starting value; change it on the right" : ""}. Drag it into position on the PCB.`)
        })
        .catch((error: Error) => notify(error.message))
        .finally(() => {
          if (file) refresh(file).catch(() => undefined)
        })
    },
    [file, refresh, notify, onPlaced, page],
  )
}
