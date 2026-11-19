// Authenticated control routes for open_studio, `copperflow studio stop` and the desktop app: which project this Studio
// serves (and who hosts it), a request that it stop itself, and a request that its window come to the front. The server
// checks Host, Origin and the key before these run.

/** Who shows this Studio: the desktop app's window; a browser tab when left out. */
export type StudioHost = "desktop"

export interface ControlHandlers {
  stop(): void
  /** Brings the hosting window to the front; without it POST /api/focus is not a route (404). */
  focus?: (() => void) | undefined
  host?: StudioHost | undefined
}

export type ControlAnswer = { root: string; host?: StudioHost } | { stopping: true } | { focused: true }

/** The answer to a control route, or undefined when the route is not one of them. */
export function controlRoute(route: string, root: string, handlers: ControlHandlers): ControlAnswer | undefined {
  if (route === "GET /api/studio") return handlers.host === undefined ? { root } : { root, host: handlers.host }
  if (route === "POST /api/stop") {
    // Answer first; the Studio closes after the answer went out.
    setImmediate(handlers.stop)
    return { stopping: true }
  }
  if (route === "POST /api/focus" && handlers.focus !== undefined) {
    handlers.focus()
    return { focused: true }
  }
  return undefined
}
