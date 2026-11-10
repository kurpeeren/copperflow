// The Studio's theme: Light or Dark, switched from View → Theme. The whole Studio changes at once: theme.css keys the
// chrome's dark tokens on `data-theme` on the root, and the schematic takes the palette of the same name. The choice
// is remembered per browser; Light until chosen. Plain TypeScript, so the tests run it without a DOM.
import type { GridStyle, GridStyles } from "../pcb/grid.js"

export type ThemeName = "light" | "dark"

export const DEFAULT_THEME: ThemeName = "light"

/** The browser storage key the choice is kept under. */
export const THEME_KEY = "copperflow.theme"

/** The part of the browser's storage the theme uses. */
export interface ThemeStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** The browser's own storage; none outside a browser. Reading `window.localStorage` may itself throw (blocked site data). */
export const browserStore = (): ThemeStore | undefined => (typeof window === "undefined" ? undefined : window.localStorage)

/** A stored value as a theme: anything but "dark" or "light" reads as the default. */
export const parseTheme = (value: unknown): ThemeName => (value === "dark" || value === "light" ? value : DEFAULT_THEME)

/** The remembered theme; Light when nothing is kept or the storage is blocked (`store` may itself throw). */
export function loadTheme(store: () => ThemeStore | undefined): ThemeName {
  try {
    return parseTheme(store()?.getItem(THEME_KEY))
  } catch {
    return DEFAULT_THEME
  }
}

/** Remembers the theme; false when the storage is missing or blocked, and the switch still holds for this visit. */
export function saveTheme(store: () => ThemeStore | undefined, theme: ThemeName): boolean {
  try {
    const storage = store()
    if (!storage) return false
    storage.setItem(THEME_KEY, theme)
    return true
  } catch {
    return false
  }
}

/** Puts the theme on the root element, where theme.css reads it. */
export function applyTheme(root: { setAttribute(name: string, value: string): void }, theme: ThemeName): void {
  root.setAttribute("data-theme", theme)
}

/** The View menu's checked pair. */
export const themeToggles = (theme: ThemeName) => ({ themeLight: theme === "light", themeDark: theme === "dark" })

/** The schematic's grid style in each theme: a quiet dot grid on the dark sheet, lines on the light one. */
export const themeGridStyle = (theme: ThemeName): GridStyle => (theme === "dark" ? "dots" : "lines")

/** The grid styles after choosing `next` while `current` is on: unchanged when it is the same theme. */
export const gridAfterThemeChoice = (styles: GridStyles, current: ThemeName, next: ThemeName): GridStyles => (current === next ? styles : withThemeGrid(styles, next))

/** The grid styles after a switch to `theme`: the schematic's follows the theme, the PCB's stays. */
export const withThemeGrid = (styles: GridStyles, theme: ThemeName): GridStyles => ({ ...styles, schematic: themeGridStyle(theme) })
