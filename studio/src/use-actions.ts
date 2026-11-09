// The edits Studio sends to its server. Each one reports a failure itself, then reloads the open file.
import { useCallback, useMemo } from "react"
import { api, type Edit } from "./api"
import { PLACE_DEFAULTS } from "./place-defaults"

/** Every action reports failures itself and resolves to whether it succeeded. */
export interface Actions {
  edit(edits: Edit[], summary: string): Promise<boolean>
  /** Like edit, and also gives the server's mark of the write, which orders it against builds (LiveProject.nextMark). */
  editMarked(edits: Edit[], summary: string): Promise<EditOutcome>
  lock(parts: string[], locked: boolean): Promise<boolean>
  mark(text: string, at?: { view: "pcb" | "schematic"; x: number; y: number }): Promise<boolean>
  unmark(id: string): Promise<boolean>
  undo(id?: string): Promise<boolean>
  verify(id: string, by: string, against: string, confirm: string): Promise<boolean>
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
  refreshParts(): Promise<void>
  notify(text: string): void
}

/** Memoised, so panels can depend on the actions in effects without refetching on every render. */
export function useActions({ file, refresh, refreshParts, notify }: ActionsInput): Actions {
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
  const editMarked = useCallback(
    async (edits: Edit[], summary: string): Promise<EditOutcome> => {
      let mark: number | undefined
      const ok = await run(async () => {
        mark = (await api<{ writeMark?: number }>("/api/edit", { file, edits, summary })).writeMark
      })
      return { ok, mark }
    },
    [file, run],
  )
  return useMemo(
    () => ({
      edit: async (edits, summary) => (await editMarked(edits, summary)).ok,
      editMarked,
      lock: (parts, locked) => run(() => api("/api/lock", { file, parts, locked })),
      mark: (text, at) => run(() => api("/api/mark", { file, text, ...at })),
      unmark: (id) => run(() => api("/api/unmark", { file, id })),
      undo: (id) => run(() => api("/api/undo", id ? { id } : {})),
      verify: async (id, by, against, confirm) => {
        const ok = await run(() => api("/api/verify", { id, by, against, confirm }))
        if (ok) await refreshParts()
        return ok
      },
      notify,
    }),
    [file, run, notify, refreshParts, editMarked],
  )
}

/** Places a built-in or library part with its starting values and selects it. */
export function usePlace({ file, refresh, notify }: ActionsInput, onPlaced: (name: string) => void): (part: string) => void {
  return useCallback(
    (part: string) => {
      const props = PLACE_DEFAULTS[part]
      api<{ name: string }>("/api/place", { file, part, ...(props ? { props } : {}) })
        .then((result) => {
          onPlaced(result.name)
          notify(`Placed ${result.name}${props ? " with a starting value; change it on the right" : ""}. Drag it into position on the PCB.`)
        })
        .catch((error: Error) => notify(error.message))
        .finally(() => {
          if (file) refresh(file).catch(() => undefined)
        })
    },
    [file, refresh, notify, onPlaced],
  )
}
