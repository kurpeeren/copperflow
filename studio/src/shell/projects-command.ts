// File → Projects…: back to the desktop app's start screen. Kept apart from use-app-commands.ts so it can be tested
// without a browser.
import type { DesktopBridge } from "./desktop-bridge.js"

/** Asks the desktop app for its start screen; a failure is told through `notify`, as the other commands tell theirs. */
export async function showProjects(bridge: DesktopBridge | undefined, notify: (note: string) => void): Promise<void> {
  if (bridge === undefined) return
  try {
    await bridge.backToProjects()
  } catch (error) {
    notify(`The projects could not be shown: ${error instanceof Error ? error.message : String(error)}`)
  }
}
