// Placing a part from the Library: with a canvas open the part is armed and the next click on it places the part there
// (pcb/use-part-place-tool.ts); with none (the 3D tab, nothing built) it is added at once and the engine places it.
import { useCallback, useEffect } from "react"
import { api } from "./api"
import { placeDefaults } from "./place-defaults"
import { placedToast, placeRequest, type AtOnceReason, type PlacedAt } from "./pcb/part-place"
import { armPart, disarmPart, setPartPlacer } from "./shell/armed-part"
import { lockGate } from "./ai-lock-gate"
import type { ActionsInput } from "./use-actions"

const MAIN_PAGE = "Main"

/** Sends one place request, selects the new part and tells where it went; settles when the request has. */
function usePlaceNow({ file, refresh, notify }: Omit<ActionsInput, "openVerify">, onPlaced: (name: string) => void, page: string) {
  return useCallback(
    (part: string, at?: PlacedAt, reason?: AtOnceReason): Promise<void> => {
      const props = placeRequest(part, at?.props)
      const startingValue = Object.keys(placeDefaults(part)).length > 0
      const body = { file, part, ...(Object.keys(props).length > 0 ? { props } : {}), ...(page === MAIN_PAGE ? {} : { page }) }
      return api<{ name: string }>("/api/place", body)
        .then((result) => {
          onPlaced(result.name)
          notify(placedToast(result.name, at, startingValue, reason))
        })
        .catch((error: Error) => notify(error.message))
        .finally(() => {
          if (file) refresh(file).catch(() => undefined)
        })
    },
    [file, refresh, notify, onPlaced, page],
  )
}

/** Closing the AI lock puts an armed part away, as it stops the other tools. */
export function useDisarmPartOnLock(closed: boolean): void {
  useEffect(() => {
    if (closed) disarmPart()
  }, [closed])
}

/** A pick in the Library: `atOnce` when the Place button was pressed with the keyboard. */
export type LibraryPick = (part: string, atOnce?: boolean) => void

/**
 * What a pick in the Library does: arm the part for a click on the open canvas, or place it at once when none is open
 * or the keyboard pressed Place. While the AI lock is closed nothing is armed or placed, and closing it puts an armed part away.
 */
export function usePlace(input: Omit<ActionsInput, "openVerify">, onPlaced: (name: string) => void, page = MAIN_PAGE): LibraryPick {
  const placeNow = usePlaceNow(input, onPlaced, page)
  useEffect(() => {
    setPartPlacer(placeNow)
    return () => setPartPlacer(null)
  }, [placeNow])
  return useCallback(
    (part: string, atOnce = false) => {
      if (lockGate.refuses()) return
      if (atOnce) return void placeNow(part, undefined, "keyboard")
      if (!armPart(part)) void placeNow(part)
    },
    [placeNow],
  )
}
