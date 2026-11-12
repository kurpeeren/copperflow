// Routing and placing in a hosted workspace: one such run at a time per workspace (the Studio's and the agent's share
// the slot), each in a worker with a hard wall-clock cut kept on this thread. A workspace container has 768 MB: the main
// thread 160, a build worker 256 and this one run's worker 256 make at most 672 MB.
import type { Placement } from "../engine/pcb-place/index.js"
import type { RouteReport } from "../engine/router/route-board.js"
import { placeWorkerFactory, type PlaceWorkerRequest } from "./place-runner.js"
import { routeWorkerFactory, type RouteWorkerRequest } from "./route-runner.js"

export const HEAVY_RUN_BUSY = "A routing or placement run is already in progress in this project; wait for it to finish (or cancel it) and try again."

/** Refused because another routing or placement run is going in this workspace. */
export class HeavyRunBusyError extends Error {
  constructor() {
    super(HEAVY_RUN_BUSY)
  }
}

let held: string | undefined

/** Takes the workspace's one routing-or-placement slot; the returned release gives it back (once). */
export function acquireHeavyRun(what: string): () => void {
  if (held !== undefined) throw new HeavyRunBusyError()
  held = what
  let released = false
  return () => {
    if (released) return
    released = true
    held = undefined
  }
}

/** The run holding the slot, if any. */
export function heavyRunHeld(): string | undefined {
  return held
}

/** The margin past a run's own budget before its worker is ended. */
const GRACE_MS = 60_000

interface MinimalWorker {
  postMessage(message: unknown): void
  on(event: "message", listener: (message: { type: string; message?: string; report?: RouteReport; placement?: Placement }) => void): unknown
  on(event: "error", listener: (error: Error) => void): unknown
  on(event: "exit", listener: (code: number) => void): unknown
  terminate(): unknown
}

function inWorker<T>(worker: MinimalWorker, request: unknown, limitMs: number, pick: (reply: { report?: RouteReport; placement?: Placement }) => T, name: string): Promise<T> {
  return new Promise((done, fail) => {
    let settled = false
    const settle = (finish: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(cap)
      void worker.terminate()
      finish()
    }
    const cap = setTimeout(() => settle(() => fail(new Error(`The ${name} took longer than ${Math.round(limitMs / 1000)} s and was stopped`))), limitMs)
    worker.on("message", (reply) => {
      if (reply.type === "progress") return
      if (reply.type === "done") return settle(() => done(pick(reply)))
      settle(() => fail(new Error(reply.message ?? `The ${name} failed`)))
    })
    worker.on("error", (error) => settle(() => fail(new Error(`The ${name} worker failed: ${error.message}`))))
    worker.on("exit", () => settle(() => fail(new Error(`The ${name} worker stopped`))))
    try {
      worker.postMessage(request)
    } catch (error) {
      settle(() => fail(new Error(`The board could not be sent to the ${name} worker: ${(error as Error).message}`)))
    }
  })
}

const NO_WORKER = "this needs a worker thread on the hosted service, and none could be started; nothing was changed"

/** The agent's autoroute in a hosted workspace: in a worker, cut at its budget plus a minute, holding the slot. */
export async function routeHosted(request: RouteWorkerRequest & { budgetMs: number }): Promise<RouteReport> {
  const release = acquireHeavyRun("autoroute")
  try {
    const factory = await routeWorkerFactory()
    if (!factory) throw new Error(`Autoroute: ${NO_WORKER}`)
    return await inWorker(factory() as unknown as MinimalWorker, request, request.budgetMs + GRACE_MS, (reply) => reply.report as RouteReport, "router")
  } finally {
    release()
  }
}

/** The agent's autoplace in a hosted workspace: in a worker, cut at its budget plus a minute, holding the slot. */
export async function placeHosted(request: PlaceWorkerRequest & { budgetMs: number }): Promise<Placement> {
  const release = acquireHeavyRun("autoplace")
  try {
    const factory = await placeWorkerFactory()
    if (!factory) throw new Error(`Autoplace: ${NO_WORKER}`)
    return await inWorker(factory() as unknown as MinimalWorker, request, request.budgetMs + GRACE_MS, (reply) => reply.placement as Placement, "placer")
  } finally {
    release()
  }
}
