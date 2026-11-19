// The desktop app's window (desktop/preload.cjs) gives its pages window.copperflowDesktop; a browser tab has none.
import type { CommandsOff } from "./menus.js"

export interface DesktopBridge {
  /** Closes this project's Studio and shows the start screen: recent projects, open a folder, a new project. */
  backToProjects(): Promise<void>
  /**
   * Shows the file or folder at this absolute path in the system's file manager. Optional: a window whose preload
   * predates it has none (and the tests' bridges name only what they use); the Files tab then offers it as off.
   */
  showInFolder?(path: string): Promise<void>
}

declare global {
  interface Window {
    copperflowDesktop?: DesktopBridge
  }
}

export const NOT_IN_DESKTOP = "In the copperflow desktop app only"

export function desktopBridge(): DesktopBridge | undefined {
  return typeof window === "undefined" ? undefined : window.copperflowDesktop
}

/** The commands only the desktop app can run, off with the reason in a browser. */
export function desktopOff(bridge: DesktopBridge | undefined = desktopBridge()): CommandsOff {
  return bridge === undefined ? { projects: NOT_IN_DESKTOP } : {}
}
