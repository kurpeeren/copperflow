import { WORKER_ENV, workerHeap } from "./worker-env.js"
import { Worker } from "node:worker_threads"
import { resolveCircuit } from "../core/workspace.js"
import type { Design } from "./design.js"
import { CircuitCodeError } from "./evaluate.js"
import { collectProjectFiles, RULES_FILE } from "./project-files.js"

/**
 * Builds designs in a worker thread, so circuit code that never ends costs one build, not the
 * Studio. Builds run one at a time, in request order.
 */

export interface EngineWorker {
  postMessage(message: unknown): void
  on(event: "message", listener: (message: unknown) => void): unknown
  on(event: "error", listener: (error: Error) => void): unknown
  on(event: "exit", listener: (code: number) => void): unknown
  terminate(): unknown
}

export interface EngineOptions {
  timeoutMs?: number
  createWorker?: () => EngineWorker
}

type WorkerReply = { id: number; design: Design } | { id: number; error: { message: string; code: "circuit-code" | "internal" } }

interface Waiter {
  done(design: Design): void
  fail(error: Error): void
}

interface Started {
  worker: EngineWorker
  waiting: Map<number, Waiter>
}

const DEFAULT_TIMEOUT_MS = 30_000
/** The footprint files of library parts. */
export const FOOTPRINT_FILE = /^parts\/[^/]+\/footprint\.yaml$/
/** The drawings a `<boardgraphic>` places (board-graphic.ts reads only these). */
/** Any case of the extension, as board-graphic.ts's GRAPHIC_FILE takes (the flag would not survive joining the sources below). */
export const GRAPHIC_FILES = /^graphics\/[^/]+\.([sS][vV][gG]|[dD][xX][fF])$/
/** The only non-source files a build reads: footprint files, drawings and the design rules. */
export const ENGINE_FILES = new RegExp(`${FOOTPRINT_FILE.source}|${GRAPHIC_FILES.source}|${RULES_FILE.source}`)

const defaultWorker = (): EngineWorker =>
  new Worker(new URL("./engine-worker.js", import.meta.url), { env: WORKER_ENV, resourceLimits: { maxOldGenerationSizeMb: workerHeap() } })

export class Engine {
  private current: Started | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private nextId = 0
  private stopped = false
  private readonly createWorker: () => EngineWorker
  private readonly timeoutMs: number

  constructor(options: EngineOptions = {}) {
    this.createWorker = options.createWorker ?? defaultWorker
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /** Builds one circuit file of the project; `file` is a path inside `root`. */
  build(root: string, file: string): Promise<Design> {
    const run = this.queue.then(() => this.run(root, file))
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Builds `main` from the given project files (paths inside the project) instead of the files on disk. */
  buildFiles(files: Record<string, string>, main: string): Promise<Design> {
    const run = this.queue.then(() => this.send(files, main))
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Ends the worker and refuses further builds. */
  async stop(): Promise<void> {
    this.stopped = true
    if (this.current) this.reset(this.current, new Error("The engine stopped"))
  }

  private async run(root: string, file: string): Promise<Design> {
    const circuit = await resolveCircuit(root, file)
    return this.send(await collectProjectFiles(root, { include: ENGINE_FILES }), circuit.file)
  }

  private send(files: Record<string, string>, main: string): Promise<Design> {
    if (this.stopped) return Promise.reject(new Error("The engine stopped"))
    const started = this.start()
    const id = ++this.nextId
    return new Promise<Design>((done, fail) => {
      const timer = setTimeout(
        () => this.reset(started, new CircuitCodeError(`The circuit code took longer than ${this.timeoutMs / 1000} s and was stopped`)),
        this.timeoutMs,
      )
      const settle =
        <T>(finish: (value: T) => void) =>
        (value: T) => {
          clearTimeout(timer)
          finish(value)
        }
      started.waiting.set(id, { done: settle(done), fail: settle(fail) })
      try {
        started.worker.postMessage({ id, files, main })
      } catch (error) {
        this.reset(started, new Error(`The build could not be sent to the worker: ${(error as Error).message}`))
      }
    })
  }

  private start(): Started {
    if (this.current) return this.current
    const started: Started = { worker: this.createWorker(), waiting: new Map() }
    started.worker.on("message", (raw) => this.receive(started, raw as WorkerReply))
    started.worker.on("error", (error) => this.reset(started, new Error(`The engine worker failed: ${error.message}`)))
    started.worker.on("exit", () => this.reset(started, new Error("The engine worker stopped")))
    this.current = started
    return started
  }

  private receive(started: Started, reply: WorkerReply): void {
    const waiter = started.waiting.get(reply.id)
    if (!waiter) return
    started.waiting.delete(reply.id)
    if (!("error" in reply)) return waiter.done(reply.design)
    waiter.fail(reply.error.code === "circuit-code" ? new CircuitCodeError(reply.error.message) : new Error(reply.error.message))
  }

  /** Fails every waiting build and drops the worker; the next build starts a new one. */
  private reset(started: Started, error: Error): void {
    if (this.current === started) this.current = undefined
    const waiting = [...started.waiting.values()]
    started.waiting.clear()
    for (const waiter of waiting) waiter.fail(error)
    void started.worker.terminate()
  }
}
