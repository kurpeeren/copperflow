import { WORKER_ENV, workerHeap } from "../engine/worker-env.js"
import { acquireHeavyRun } from "./heavy-runs.js"
// Place → Autoplace on the server, in the router's pattern (route-runner.ts): one run at a time, in a worker thread,
// its progress and its end told through the live events ("place"). The design is built afresh after the content hashes
// are taken; the placement is written through the core as one history entry by the person (pcbX/pcbY/pcbRotation, in
// the sheet files for parts of sub-sheet instances), unless a file changed meanwhile or the run was cancelled.
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { lockedPartsAt, withInstanceParts } from "../core/layout-locks.js"
import { placementWrites, writePlacement, type FilesBuilder } from "../core/placement-write.js"
import { resolveCircuit } from "../core/workspace.js"
import type { Design } from "../engine/design.js"
import { DEFAULT_FIT_MARGIN, placeBoard, type Placement, type PlaceProgress } from "../engine/pcb-place/index.js"
import type { PlaceScope } from "../engine/pcb-place/scope.js"
import { findInstance } from "../engine/router/route-board.js"
import { placeSummary, type PlaceEvent } from "./place-events.js"
import { discardReason, type ContentHashes } from "./route-events.js"
import { contentHashes, type RouteWorker } from "./route-runner.js"

/** What the worker is sent: the design, the scope and the parts that stay. */
export interface PlaceWorkerRequest {
  design: Design
  scope: PlaceScope
  locked: string[]
  budgetMs?: number
  /** Try connectors ahead of the parts they serve (`PlaceOptions.connectorsAhead`); the Studio never sets it. */
  connectorsAhead?: boolean
}

export type PlaceWorkerReply = { type: "progress"; progress: PlaceProgress } | { type: "done"; placement: Placement } | { type: "error"; message: string }

export type PlaceWorker = Omit<RouteWorker, "postMessage" | "on"> & {
  postMessage(message: PlaceWorkerRequest): void
  on(event: "message", listener: (message: PlaceWorkerReply) => void): unknown
  on(event: "error", listener: (error: Error) => void): unknown
  on(event: "exit", listener: (code: number) => void): unknown
}
export type PlaceWorkerFactory = () => PlaceWorker

const PROGRESS_MS = 100
/** The Studio's placement time budget. */
export const STUDIO_PLACE_BUDGET_MS = 20_000

/** The factory of placer workers, or undefined without worker threads or the built worker file. */
export async function placeWorkerFactory(): Promise<PlaceWorkerFactory | undefined> {
  const file = new URL("./place-worker.js", import.meta.url)
  if (!existsSync(fileURLToPath(file))) return undefined
  try {
    const { Worker } = await import("node:worker_threads")
    return () => new Worker(file, { env: WORKER_ENV, resourceLimits: { maxOldGenerationSizeMb: workerHeap() } }) as unknown as PlaceWorker
  } catch (error) {
    console.error(`copperflow studio: worker threads are unavailable (${(error as Error).message}); the placer runs in the server process`)
    return undefined
  }
}

export interface PlaceRunnerDeps {
  root: string
  build(circuit: string): Promise<Design>
  announce(event: PlaceEvent): void
  nextMark(): number
  requestBuild(circuit: string): void
  createWorker: PlaceWorkerFactory | undefined
  /** Behind the hub: never place in the server process, and fit the board with this engine-worker build. */
  hosted?: { buildFiles: FilesBuilder }
  /** The hard wall-clock cut of a run in a worker; default PLACE_WORKER_LIMIT_MS. */
  workerLimitMs?: number
}

/** The longest a placement may take in its worker before the worker is ended: its budget and a minute's grace. */
export const PLACE_WORKER_LIMIT_MS = STUDIO_PLACE_BUDGET_MS + 60_000

/** The answer when the hosted Studio has no worker threads: it does not fall back to its own thread. */
export const NO_WORKER_HOSTED = "this needs a worker thread on the hosted service, and none could be started; nothing was changed"

class Cancelled extends Error {}
class Discarded extends Error {}

interface Job {
  file: string
  cancelled: boolean
  committed: boolean
  stop(): void
}

/** The scope checked against the design: a part or instance it lacks is refused with its name. */
export function checkedPlaceScope(design: Design, scope: PlaceScope): PlaceScope {
  if (scope.kind === "parts") {
    const known = new Set(design.circuit.components.map((c) => c.id))
    const missing = scope.parts.filter((part) => !known.has(part))
    if (missing.length > 0) throw new Error(`The circuit has no ${missing.length === 1 ? "part" : "parts"} ${missing.join(", ")}. Nothing was placed.`)
  }
  if (scope.kind === "instance" && !findInstance(design.circuit.instances, scope.instance)) throw new Error(`The circuit has no sub-sheet instance ${scope.instance}. Nothing was placed.`)
  return scope
}

/** The locked parts of the circuit, a locked instance's parts included. */
export async function lockedNames(circuitPath: string, design: Design): Promise<string[]> {
  return [...withInstanceParts(await lockedPartsAt(circuitPath), design.circuit.instances)]
}

/** discardReason, worded for placement. */
const placeDiscard = (why: string) => why.replace("while the board was routed", "while the board was placed").replace("; route again", "; place again")

export class PlaceRunner {
  private job: Job | undefined

  constructor(private readonly deps: PlaceRunnerDeps) {}

  get running(): string | undefined {
    return this.job?.file
  }

  /** Starts placing `file` in `scope` (fitting the board after, with `fit`); answers its project path once under way. */
  async start(file: string, scope: PlaceScope, fit = false): Promise<string> {
    if (this.job) throw new Error(`The board of ${this.job.file} is being placed; cancel it or wait for it to end`)
    if (this.deps.hosted && !this.deps.createWorker) throw new Error(`Autoplace: ${NO_WORKER_HOSTED}`)
    // Hosted: one routing-or-placement run per workspace at a time, the agent's included (heavy-runs.ts).
    const release = this.deps.hosted ? acquireHeavyRun("studio autoplace") : () => undefined
    const job: Job = { file, cancelled: false, committed: false, stop: () => undefined }
    this.job = job
    try {
      const circuit = await resolveCircuit(this.deps.root, file)
      if (!circuit.file.endsWith(".circuit.tsx")) throw new Error(`${circuit.file} is a sub-sheet; open the circuit that uses it to place its board`)
      job.file = circuit.file
      const start = await contentHashes(this.deps.root, circuit.file)
      const design = await this.deps.build(circuit.file)
      checkedPlaceScope(design, scope)
      const locked = await lockedNames(circuit.path, design)
      this.deps.announce({ file: circuit.file, state: "started", scope, ...(this.deps.createWorker ? {} : { inProcess: true }) })
      void this.run(job, circuit, { scope, fit, start, design, locked }).finally(() => {
        release()
        if (this.job === job) this.job = undefined
      })
      return circuit.file
    } catch (error) {
      release()
      this.job = undefined
      throw error
    }
  }

  cancel(): boolean {
    const job = this.job
    if (!job || job.cancelled || job.committed) return false
    job.cancelled = true
    job.stop()
    return true
  }

  private async run(job: Job, circuit: { path: string; file: string }, input: { scope: PlaceScope; fit: boolean; start: ContentHashes; design: Design; locked: string[] }): Promise<void> {
    const file = circuit.file
    const { scope, fit, start, design, locked } = input
    try {
      const placement = await this.compute(job, { design, scope, locked, budgetMs: STUDIO_PLACE_BUDGET_MS })
      const writes = placementWrites(design, placement.positions, placement.blocks)
      const guard = async () => {
        if (job.cancelled) throw new Cancelled()
        const why = discardReason(start, await contentHashes(this.deps.root, file))
        if (why !== undefined) throw new Discarded(placeDiscard(why))
        job.committed = true
      }
      const nothing = writes.circuit.length + writes.sheets.length + writes.blocks.length === 0 && !fit
      if (nothing) await guard()
      const written = nothing ? undefined : await writePlacement(this.deps.root, file, writes, { author: "human", summary: placeSummary(scope, placement.positions.size), guard, ...(fit ? { fit: { margin: DEFAULT_FIT_MARGIN, ...(this.deps.hosted ? { build: this.deps.hosted.buildFiles } : {}) } } : {}) })
      const mark = written?.entry ? { entryId: written.entry.id, writeMark: this.deps.nextMark() } : {}
      if (written?.entry) this.deps.requestBuild(file)
      const board = written?.board === undefined ? {} : { board: "error" in written.board ? { error: written.board.error } : { width: written.board.width, height: written.board.height } }
      this.deps.announce({
        file,
        state: "done",
        placed: written?.written.length ?? 0,
        wireLength: placement.score.wireLength,
        before: placement.before.wireLength,
        unplaced: placement.unplaced,
        notes: [...placement.notes, ...writes.notes, ...(written?.skipped ?? []).map((s) => `${s}; it was not moved`)],
        ...board,
        ...mark,
      })
    } catch (error) {
      if (error instanceof Discarded) return this.deps.announce({ file, state: "discarded", reason: error.message })
      if (error instanceof Cancelled || (job.cancelled && !job.committed)) return this.deps.announce({ file, state: "cancelled" })
      const message = (error instanceof Error ? error.message : String(error)).split(this.deps.root).join(".")
      this.deps.announce({ file, state: "failed", error: message })
    }
  }

  private compute(job: Job, request: PlaceWorkerRequest): Promise<Placement> {
    let last = Number.NEGATIVE_INFINITY
    const tell = (progress: PlaceProgress) => {
      const now = Date.now()
      if (now - last < PROGRESS_MS && progress.done < progress.total) return
      last = now
      this.deps.announce({ file: job.file, state: "running", stage: progress.stage, done: progress.done, total: progress.total })
    }
    const factory = this.deps.createWorker
    return factory ? inWorker(job, factory, request, tell, this.deps.workerLimitMs ?? PLACE_WORKER_LIMIT_MS) : inProcess(job, request, tell)
  }
}

/** Places in a worker; cancelling ends the worker, and so does running past `limitMs` (the timer is this thread's). */
function inWorker(job: Job, factory: PlaceWorkerFactory, request: PlaceWorkerRequest, tell: (progress: PlaceProgress) => void, limitMs: number): Promise<Placement> {
  return new Promise((done, fail) => {
    const worker = factory()
    let settled = false
    const settle = (finish: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(cap)
      void worker.terminate()
      finish()
    }
    const cap = setTimeout(() => settle(() => fail(new Error(`The placer took longer than ${Math.round(limitMs / 1000)} s and was stopped`))), limitMs)
    job.stop = () => settle(() => fail(new Cancelled()))
    worker.on("message", (reply) => {
      if (reply.type === "progress") return settled ? undefined : tell(reply.progress)
      if (reply.type === "done") return settle(() => done(reply.placement))
      settle(() => fail(new Error(reply.message)))
    })
    worker.on("error", (error) => settle(() => fail(new Error(`The placer worker failed: ${error.message}`))))
    worker.on("exit", () => settle(() => fail(new Error("The placer worker stopped"))))
    try {
      worker.postMessage(request)
    } catch (error) {
      settle(() => fail(new Error(`The board could not be sent to the placer worker: ${(error as Error).message}`)))
    }
  })
}

async function inProcess(job: Job, request: PlaceWorkerRequest, tell: (progress: PlaceProgress) => void): Promise<Placement> {
  await new Promise((next) => setImmediate(next))
  if (job.cancelled) throw new Cancelled()
  return placeBoard(request.design, {
    scope: request.scope,
    locked: request.locked,
    ...(request.budgetMs === undefined ? {} : { budgetMs: request.budgetMs }),
    ...(request.connectorsAhead ? { connectorsAhead: true } : {}),
    onProgress: (progress) => {
      if (job.cancelled) throw new Cancelled()
      tell(progress)
    },
  })
}
