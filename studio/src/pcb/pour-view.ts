// View → Pour fill: how the PCB draws the pours' copper, solid (the layer's colour at 35% alpha), hatched or as an
// outline only. Remembered per browser as hover-label-setting.ts remembers the hover labels. Plain TypeScript, so the
// tests run it without a DOM.
import type { ThemeStore } from "../shell/theme-state.js"

export type PourFillMode = "solid" | "hatched" | "outline"

export const POUR_FILL_MODES: readonly PourFillMode[] = ["solid", "hatched", "outline"]
export const DEFAULT_POUR_FILL: PourFillMode = "solid"

/** The browser storage key the choice is kept under. */
export const POUR_FILL_KEY = "copperflow.pourFill"

/** The alpha a fill is drawn at, solid or hatched. */
export const POUR_FILL_ALPHA = 0.35

const isMode = (value: unknown): value is PourFillMode => (POUR_FILL_MODES as readonly unknown[]).includes(value)

/** The remembered choice; solid when nothing (or nothing known) is kept, or the storage is blocked. */
export function loadPourFill(store: () => ThemeStore | undefined): PourFillMode {
  try {
    const kept = store()?.getItem(POUR_FILL_KEY)
    return isMode(kept) ? kept : DEFAULT_POUR_FILL
  } catch {
    return DEFAULT_POUR_FILL
  }
}

/** Remembers the choice; false when the storage is missing or blocked, and the choice still holds for this visit. */
export function savePourFill(store: () => ThemeStore | undefined, mode: PourFillMode): boolean {
  try {
    const storage = store()
    if (!storage) return false
    storage.setItem(POUR_FILL_KEY, mode)
    return true
  } catch {
    return false
  }
}

/** The View menu's three Pour fill items, one checked. */
export function pourFillToggles(mode: PourFillMode): { pourSolid: boolean; pourHatched: boolean; pourOutline: boolean } {
  return { pourSolid: mode === "solid", pourHatched: mode === "hatched", pourOutline: mode === "outline" }
}

/** The mode a View → Pour fill command picks. */
export const POUR_FILL_COMMANDS = { pourSolid: "solid", pourHatched: "hatched", pourOutline: "outline" } as const satisfies Record<string, PourFillMode>
