// The desktop app's window (desktop/preload.cjs) gives its pages window.copperflowDesktop; a browser tab has none.
import type { CommandsOff } from "./menus.js"

export interface DesktopBridge {
  /** Closes this project's Studio and shows the start screen: recent projects, open a folder, a new project. */
  backToProjects(): Promise<void>
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
