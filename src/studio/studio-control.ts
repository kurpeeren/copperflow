// Two authenticated routes for open_studio and `copperflow studio stop`: which project this Studio serves, and a
// request that it stop itself. The server checks Host, Origin and the key before these run.

/** The answer to a control route, or undefined when the route is not one of them. */
export function controlRoute(route: string, root: string, stop: () => void): { root: string } | { stopping: true } | undefined {
  if (route === "GET /api/studio") return { root }
  if (route === "POST /api/stop") {
    // Answer first; the Studio closes after the answer went out.
    setImmediate(stop)
    return { stopping: true }
  }
  return undefined
}
