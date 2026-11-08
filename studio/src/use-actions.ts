// The edits Studio sends to its server. Each one reports a failure itself, then reloads the open file.
import { useCallback, useMemo } from "react"
import { api, type Edit } from "./api"

/** Every action reports failures itself and resolves to whether it succeeded. */
export interface Actions {
  edit(edits: Edit[], summary: string): Promise<boolean>
  lock(parts: string[], locked: boolean): Promise<boolean>
  mark(text: string, at?: { view: "pcb" | "schematic"; x: number; y: number }): Promise<boolean>
  unmark(id: string): Promise<boolean>
  undo(id?: string): Promise<boolean>
  verify(id: string, by: string, against: string, confirm: string): Promise<boolean>
  notify(text: string): void
}

interface ActionsInput {
  file: string | undefined
  refresh(file: string): Promise<void>
  refreshParts(): Promise<void>
  notify(text: string): void
}

/** Starting values for built-in parts, so a placed part has a value and a footprint at once. */
const PLACE_DEFAULTS: Record<string, Record<string, string>> = {
  resistor: { resistance: "10k", footprint: "0402" },
  capacitor: { capacitance: "100nF", footprint: "0402" },
  inductor: { inductance: "10uH", footprint: "0805" },
  led: { color: "red", footprint: "0603" },
  crystal: { frequency: "16MHz" },
  fuse: { currentRating: "500mA", footprint: "1206" },
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
  return useMemo(
    () => ({
      edit: (edits, summary) => run(() => api("/api/edit", { file, edits, summary })),
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
    [file, run, notify, refreshParts],
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
