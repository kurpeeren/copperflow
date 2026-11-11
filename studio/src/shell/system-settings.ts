// Settings → System, as EasyEDA's system settings: the theme, the PCB's display unit, each document's starting Grid
// step and the hover labels, kept per browser. The theme and the hover labels keep their own keys (theme-state.ts,
// hover-label-setting.ts), so View → Theme and View → Hover labels stay the same setting; the unit and the grid steps
// are kept here. Plain TypeScript, so the tests run it without a DOM.
import { PCB_DEFAULT_STEP, PCB_GRID_STEPS, SHEET_DEFAULT_STEP, SHEET_GRID_STEPS, type GridSteps } from "../pcb/grid.js"
import type { Unit } from "../pcb/units.js"
import type { ThemeName, ThemeStore } from "./theme-state.js"

/** The browser storage key the unit and the grid steps are kept under, as JSON. */
export const SYSTEM_KEY = "copperflow.system"

/** What the dialog shows and writes. */
export interface SystemSettings {
  theme: ThemeName
  unit: Unit
  grid: GridSteps
  hoverLabels: boolean
}

/** The part of the settings kept under SYSTEM_KEY. */
export type StoredSystem = Pick<SystemSettings, "unit" | "grid">

export const DEFAULT_SYSTEM: StoredSystem = { unit: "mm", grid: { schematic: SHEET_DEFAULT_STEP, pcb: PCB_DEFAULT_STEP } }

const oneOf = (value: unknown, list: readonly number[], fallback: number): number => (typeof value === "number" && list.includes(value) ? value : fallback)

/** A stored value read back: anything missing or not one of the choices falls back to the default. */
export function parseSystem(text: string | null | undefined): StoredSystem {
  let data: { unit?: unknown; grid?: { schematic?: unknown; pcb?: unknown } } = {}
  try {
    data = text ? (JSON.parse(text) as typeof data) : {}
  } catch {
    data = {}
  }
  const grid = typeof data.grid === "object" && data.grid !== null ? data.grid : {}
  return {
    unit: data.unit === "mil" ? "mil" : "mm",
    grid: { schematic: oneOf(grid.schematic, SHEET_GRID_STEPS, SHEET_DEFAULT_STEP), pcb: oneOf(grid.pcb, PCB_GRID_STEPS, PCB_DEFAULT_STEP) },
  }
}

/** The kept settings; the defaults when nothing is kept or the storage is blocked (`store` may itself throw). */
export function loadSystem(store: () => ThemeStore | undefined): StoredSystem {
  try {
    return parseSystem(store()?.getItem(SYSTEM_KEY))
  } catch {
    return DEFAULT_SYSTEM
  }
}

/** Keeps the settings; false when the storage is missing or blocked, and they still hold for this visit. */
export function saveSystem(store: () => ThemeStore | undefined, settings: StoredSystem): boolean {
  try {
    const storage = store()
    if (!storage) return false
    storage.setItem(SYSTEM_KEY, JSON.stringify({ unit: settings.unit, grid: settings.grid }))
    return true
  } catch {
    return false
  }
}
