// The router and the placer as the agent's tools run them, their progress told while they work. When someone listens
// (the client asked for progress, or a Studio is open) and the built workers are there, the run goes to a worker thread,
// so its progress leaves this process as it comes; otherwise it runs here, as before, and only its steps are told.
// Starting a worker costs a fraction of a second, which is why a run nobody watches stays in this process. A worker
// that fails runs the job here instead, and the tool's answer says so.
import type { Design } from "../engine/design.js"
import { placeBoard, type PlaceOptions, type Placement, type PlaceProgress } from "../engine/pcb-place/index.js"
import { placeBoardFitting } from "../engine/pcb-place/grow.js"
import { routeBoard, type RouteBoardInput, type RouteProgress, type RouteReport, type RouteScope } from "../engine/router/route-board.js"
import type { PlaceScope } from "../engine/pcb-place/scope.js"
import { placeWorkerFactory, type PlaceWorkerFactory } from "../studio/place-runner.js"
import { routeWorkerFactory, type RouteWorkerFactory } from "../studio/route-runner.js"
import type { Reporter } from "./tool-activity.js"
import { runInWorker, throwIfCancelled, WORKER_GRACE_MS, WorkerFailure } from "./worker-run.js"

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`
const PERCENT = 100

let routeFactory: Promise<RouteWorkerFactory | undefined> | undefined
let placeFactory: Promise<PlaceWorkerFactory | undefined> | undefined

/** Tells the step and lets it leave before a run that holds this thread; nothing when nobody listens. */
async function stepBeforeRun(report: Reporter, step: string): Promise<void> {
  if (!report.heard) return
  report.step(step)
  await new Promise((next) => setImmediate(next))
}

/** "Routing: 3 of 8 connections, pass 2", or the cleanup step. */
export function tellRoute(report: Reporter, progress: RouteProgress): void {
  if (progress.stage === "cleanup") return report.step("Tidying the routes")
  report.count(`Routing: ${progress.done} of ${plural(progress.total, "connection")}, pass ${progress.pass}`, progress.done, progress.total)
}

/** "Placing: 3 of 12 parts", then "Placing: refining, 40%". */
export function tellPlace(report: Reporter, progress: PlaceProgress): void {
  if (progress.stage === "construct") return report.count(`Placing: ${progress.done} of ${plural(progress.total, "part")}`, progress.done, progress.total)
  const percent = Math.round((PERCENT * progress.done) / Math.max(1, progress.total))
  report.count(`Placing: refining, ${percent}%`, progress.done, progress.total)
}

/** A run's result, and the line the tool's answer adds when the run had to leave its worker. */
export interface Told<T> {
  result: T
  note?: string
}

/**
 * The run in its worker; when the worker itself fails (it cannot start, runs out of memory, stops without a result),
 * the same job in this process, as before workers were used, with a note that says so. A job that failed on its own
 * terms, ran past its limit or was cancelled is not run again.
 */
async function inWorkerOrHere<T>(what: string, inWorker: () => Promise<T>, here: () => Promise<T>): Promise<Told<T>> {
  try {
    return { result: await inWorker() }
  } catch (error) {
    if (!(error instanceof WorkerFailure)) throw error
    return { result: await here(), note: `The ${what} ran in this process because its worker failed (${error.reason}).` }
  }
}

export interface RouteRun {
  scope: RouteScope
  budgetMs: number
  /** A test's clock: the run then stays in this process, where that clock is. */
  clock?: (() => number) | undefined
  /** The worker factory; null keeps the run in this process. By default the built router worker, when there is one. */
  worker?: RouteWorkerFactory | null | undefined
  /** The client's cancel: a worker is ended, and a run in this process does not start. */
  signal?: AbortSignal | undefined
}

/** The router's report for `input`, its progress told to `report`. */
export async function routeTold(input: RouteBoardInput, run: RouteRun, report: Reporter): Promise<Told<RouteReport>> {
  throwIfCancelled(run.signal, "router")
  const factory = run.worker === null || run.clock !== undefined || !report.heard ? undefined : (run.worker ?? (await (routeFactory ??= routeWorkerFactory())))
  const here = async () => {
    await stepBeforeRun(report, "Routing the connections")
    throwIfCancelled(run.signal, "router")
    return routeBoard(input, { scope: run.scope, budgetMs: run.budgetMs, ...(run.clock ? { clock: run.clock } : {}) })
  }
  if (factory === undefined) return { result: await here() }
  const inWorker = () =>
    runInWorker(factory, {
      request: { input, scope: run.scope, budgetMs: run.budgetMs },
      progress: (progress: RouteProgress) => tellRoute(report, progress),
      result: (reply: { report: RouteReport }) => reply.report,
      limitMs: run.budgetMs + WORKER_GRACE_MS,
      what: "router",
      signal: run.signal,
    })
  return inWorkerOrHere("router", inWorker, here)
}

export interface PlaceRun {
  scope: PlaceScope
  locked: string[]
  budgetMs: number
  connectorsAhead: boolean
  /** Grow the board for parts with no room: that run is the fitting placer's, which only runs in this process. */
  fit: boolean
  clock?: (() => number) | undefined
  worker?: PlaceWorkerFactory | null | undefined
  signal?: AbortSignal | undefined
}

/** The placement of `design`, its progress told to `report`. */
export async function placeTold(design: Design, run: PlaceRun, report: Reporter): Promise<Told<Placement>> {
  throwIfCancelled(run.signal, "placer")
  const inProcess = run.worker === null || run.fit || run.clock !== undefined || !report.heard
  const factory = inProcess ? undefined : (run.worker ?? (await (placeFactory ??= placeWorkerFactory())))
  const here = async () => {
    await stepBeforeRun(report, run.fit ? "Placing the parts and fitting the board" : "Placing the parts")
    throwIfCancelled(run.signal, "placer")
    const options: PlaceOptions = { scope: run.scope, locked: run.locked, budgetMs: run.budgetMs, ...(run.connectorsAhead ? { connectorsAhead: true } : {}), ...(run.clock ? { clock: run.clock } : {}) }
    return (run.fit ? placeBoardFitting : placeBoard)(design, options)
  }
  if (factory === undefined) return { result: await here() }
  const inWorker = () =>
    runInWorker(factory, {
      request: { design, scope: run.scope, locked: run.locked, budgetMs: run.budgetMs, ...(run.connectorsAhead ? { connectorsAhead: true } : {}) },
      progress: (progress: PlaceProgress) => tellPlace(report, progress),
      result: (reply: { placement: Placement }) => reply.placement,
      limitMs: run.budgetMs + WORKER_GRACE_MS,
      what: "placer",
      signal: run.signal,
    })
  return inWorkerOrHere("placer", inWorker, here)
}
