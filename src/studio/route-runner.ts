// Route → Autoroute on the server: one run at a time, in a worker thread so the Studio stays responsive, its progress
// and its end told through the live events ("route"). The copper is written as one history entry (author human, records
// by the router), unless the circuit or its layout file changed while the run was computed (content hashes at start
// and end), or the run was cancelled. Without worker threads (or without the built worker file, as when the server
// runs from its TypeScript sources) the run is computed in the server process, which says so.
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { applyLayoutEdits } from "../core/layout-edits.js"
import { layoutPathFor } from "../core/layout-file.js"
import { lockedPartsAt, lockedStart, type DesignSource } from "../core/layout-locks.js"
import type { LayoutEdit } from "../core/layout-records.js"
import { readIfThere } from "../core/file-writes.js"
import { startOffLocked } from "../core/unroute.js"
import { resolveCircuit } from "../core/workspace.js"
import type { Design } from "../engine/design.js"
import { routeBoard, type RouteBoardInput, type RouteProgress, type RouteReport, type RouteScope } from "../engine/router/route-board.js"
import { discardReason, routeSummary, type ContentHashes, type RouteEvent } from "./route-events.js"

/** What the worker is sent: the board and the scope. */
export interface RouteWorkerRequest {
  input: RouteBoardInput
  scope: RouteScope
}

/** What the worker answers: progress while it routes, then the report or why it failed. */
export type RouteWorkerReply = { type: "progress"; progress: RouteProgress } | { type: "done"; report: RouteReport } | { type: "error"; message: string }

export interface RouteWorker {
  postMessage(message: RouteWorkerRequest): void
  on(event: "message", listener: (message: RouteWorkerReply) => void): unknown
  on(event: "error", listener: (error: Error) => void): unknown
  on(event: "exit", listener: (code: number) => void): unknown
  terminate(): unknown
}

export type RouteWorkerFactory = () => RouteWorker

const WORKER_HEAP_MB = 2048
/** Progress is told at most this often; the end of the cleanup always. */
const PROGRESS_MS = 100

/**
 * The factory of router workers, or undefined when there can be none: worker threads unavailable (a note goes to the
 * terminal), or no built worker file next to this module (the server runs from its sources).
 */
export async function routeWorkerFactory(): Promise<RouteWorkerFactory | undefined> {
  const file = new URL("./router-worker.js", import.meta.url)
  if (!existsSync(fileURLToPath(file))) return undefined
  try {
    const { Worker } = await import("node:worker_threads")
    return () => new Worker(file, { resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } }) as unknown as RouteWorker
  } catch (error) {
    console.error(`copperflow studio: worker threads are unavailable (${(error as Error).message}); the router runs in the server process`)
    return undefined
  }
}

/** What the runner needs of the server. */
export interface RouteRunnerDeps {
  root: string
  /** The built design of a circuit file: the live one when current, else a fresh build. */
  designOf(circuit: string): Promise<Design>
  /** Tells the viewers. */
  announce(event: RouteEvent): void
  /** Takes the server's next mark (LiveProject.nextMark) after a write. */
  nextMark(): number
  /** Builds the circuit again after a write. */
  requestBuild(circuit: string): void
  /** Undefined runs the router in the server process. */
  createWorker: RouteWorkerFactory | undefined
}

class Cancelled extends Error {}

/** The run going now. */
interface Job {
  file: string
  cancelled: boolean
  /** Stops the computation: ends the worker, or makes the in-process run stop at its next progress. */
  stop(): void
}

const hash = (text: string | undefined) => createHash("sha256").update(text ?? "").digest("hex")

export class RouteRunner {
  private job: Job | undefined

  constructor(private readonly deps: RouteRunnerDeps) {}

  /** The circuit file being routed now, if any. */
  get running(): string | undefined {
    return this.job?.file
  }

  /**
   * Starts routing the circuit `file` in `scope` and returns its project path once the run is under way; the run
   * goes on and is told through the events. Throws when another run is going or the file is not a circuit.
   */
  async start(file: string, scope: RouteScope): Promise<string> {
    if (this.job) throw new Error(`The board of ${this.job.file} is being routed; cancel it or wait for it to end`)
    const job: Job = { file, cancelled: false, stop: () => undefined }
    this.job = job
    try {
      const circuit = await resolveCircuit(this.deps.root, file)
      if (!circuit.file.endsWith(".circuit.tsx")) throw new Error(`${circuit.file} is a sub-sheet; open the circuit that uses it to route its board`)
      job.file = circuit.file
      this.deps.announce({ file: circuit.file, state: "started", scope, ...(this.deps.createWorker ? {} : { inProcess: true }) })
      void this.run(job, circuit, scope).finally(() => {
        if (this.job === job) this.job = undefined
      })
      return circuit.file
    } catch (error) {
      this.job = undefined
      throw error
    }
  }

  /** Cancels the run going now; whether there was one. */
  cancel(): boolean {
    const job = this.job
    if (!job || job.cancelled) return false
    job.cancelled = true
    job.stop()
    return true
  }

  private async hashes(circuit: { path: string }): Promise<ContentHashes> {
    const [code, layout] = await Promise.all([readIfThere(circuit.path), readIfThere(layoutPathFor(circuit.path))])
    return { circuit: hash(code), layout: hash(layout) }
  }

  private async run(job: Job, circuit: { path: string; file: string }, scope: RouteScope): Promise<void> {
    const file = circuit.file
    try {
      const start = await this.hashes(circuit)
      const design = await this.deps.designOf(file)
      if (job.cancelled) throw new Cancelled()
      const input: RouteBoardInput = { layout: design.pcb, rules: design.rules, nets: design.circuit.nets, components: design.circuit.components, ...(design.circuit.instances ? { instances: design.circuit.instances } : {}) }
      const report = await this.compute(job, { input, scope })
      if (job.cancelled) throw new Cancelled()
      const why = discardReason(start, await this.hashes(circuit))
      if (why !== undefined) return this.deps.announce({ file, state: "discarded", reason: why })
      const written = report.edits.length === 0 ? {} : await this.write(circuit, design, scope, report)
      const total = report.routed.length + report.unrouted.length
      this.deps.announce({ file, state: "done", routed: report.routed.length, total, passes: report.passes, unrouted: report.unrouted, cleanupCapped: report.cleanupCapped, ...written })
    } catch (error) {
      if (error instanceof Cancelled || job.cancelled) return this.deps.announce({ file, state: "cancelled" })
      const message = (error instanceof Error ? error.message : String(error)).split(this.deps.root).join(".")
      this.deps.announce({ file, state: "failed", error: message })
    }
  }

  /** The copper as one history entry, by the router, with no track starting on a locked part's pad. */
  private async write(circuit: { path: string; file: string }, design: Design, scope: RouteScope, report: RouteReport): Promise<{ entryId: string; writeMark: number }> {
    const locked = await lockedPartsAt(circuit.path)
    const onLocked = lockedStart(locked, design)
    const edits: LayoutEdit[] =
      locked.size === 0 ? report.edits : startOffLocked(report.edits, (point, layer) => onLocked({ t: "track", id: "", layer, width: 1, points: [point], locked: false, by: "router" }) !== undefined)
    const total = report.routed.length + report.unrouted.length
    const source: DesignSource = (name) => this.deps.designOf(name)
    const result = await applyLayoutEdits(this.deps.root, circuit.file, edits, { author: "human", router: true, summary: routeSummary(scope, report.routed.length, total), design: source })
    const writeMark = this.deps.nextMark()
    this.deps.requestBuild(circuit.file)
    return { entryId: result.entry.id, writeMark }
  }

  /** The report, from a worker or in this process; progress is told as it comes. */
  private compute(job: Job, request: RouteWorkerRequest): Promise<RouteReport> {
    let last = Number.NEGATIVE_INFINITY
    const tell = (progress: RouteProgress) => {
      if (progress.stage === "cleanup") return this.deps.announce({ file: job.file, state: "cleanup", capped: progress.capped })
      const now = Date.now()
      if (now - last < PROGRESS_MS && progress.done < progress.total) return
      last = now
      this.deps.announce({ file: job.file, state: "running", pass: progress.pass, done: progress.done, total: progress.total })
    }
    const factory = this.deps.createWorker
    return factory ? inWorker(job, factory, request, tell) : inProcess(job, request, tell)
  }
}

/** Routes in a worker; cancelling ends the worker. */
function inWorker(job: Job, factory: RouteWorkerFactory, request: RouteWorkerRequest, tell: (progress: RouteProgress) => void): Promise<RouteReport> {
  return new Promise((done, fail) => {
    const worker = factory()
    let settled = false
    const settle = (finish: () => void) => {
      if (settled) return
      settled = true
      void worker.terminate()
      finish()
    }
    job.stop = () => settle(() => fail(new Cancelled()))
    worker.on("message", (reply) => {
      if (reply.type === "progress") return settled ? undefined : tell(reply.progress)
      if (reply.type === "done") return settle(() => done(reply.report))
      settle(() => fail(new Error(reply.message)))
    })
    worker.on("error", (error) => settle(() => fail(new Error(`The router worker failed: ${error.message}`))))
    worker.on("exit", () => settle(() => fail(new Error("The router worker stopped"))))
    try {
      worker.postMessage(request)
    } catch (error) {
      settle(() => fail(new Error(`The board could not be sent to the router worker: ${(error as Error).message}`)))
    }
  })
}

/** Routes in this process, after the request that started it is answered; a cancel is seen at the next progress. */
async function inProcess(job: Job, request: RouteWorkerRequest, tell: (progress: RouteProgress) => void): Promise<RouteReport> {
  await new Promise((next) => setImmediate(next))
  if (job.cancelled) throw new Cancelled()
  return routeBoard(request.input, {
    scope: request.scope,
    onProgress: (progress) => {
      if (job.cancelled) throw new Cancelled()
      tell(progress)
    },
  })
}
