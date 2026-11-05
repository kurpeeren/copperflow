import { existsSync, realpathSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { Worker } from "node:worker_threads"
import { resolveCircuit } from "../core/workspace.js"
import { collectProjectFiles, MAX_PROJECT_BYTES } from "../engine/project-files.js"

/**
 * Builds circuits with tscircuit's eval library in one long-lived worker thread. Starting the
 * tscircuit CLI costs about 20 s on every build; a worker pays the loading cost once, so the
 * editor shows a change after a few seconds.
 */

/** The fast build cannot run this build (no library, an import it cannot resolve, a timeout…); use `tsci build`. */
export class FastBuildUnavailable extends Error {
  override name = "FastBuildUnavailable"
}

export interface EvalWorker {
  postMessage(message: unknown): void
  on(event: "message", listener: (message: unknown) => void): unknown
  on(event: "error", listener: (error: Error) => void): unknown
  on(event: "exit", listener: (code: number) => void): unknown
  terminate(): Promise<number> | void
}

export type WorkerFactory = (evalEntry: string) => EvalWorker

export interface EvaluatorOptions {
  createWorker?: WorkerFactory
  timeoutMs?: number
  maxProjectBytes?: number
  /** Builds before the worker is replaced; the eval library keeps memory from build to build. */
  buildsPerWorker?: number
}

type WorkerMessage =
  | { type: "ready" }
  | { type: "failed"; message: string }
  | { type: "result"; id: number; json: unknown }
  | { type: "error"; id: number; message: string }

interface Waiter {
  done(json: unknown[]): void
  fail(error: Error): void
}

interface Started {
  worker: EvalWorker
  ready: Promise<void>
  waiting: Map<number, Waiter>
  builds: number
}

const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_BUILDS_PER_WORKER = 20
const WORKER_HEAP_MB = 4096
// The CLI applies this file's settings; the worker does not, so such projects use the CLI.
const PROJECT_CONFIG = "tscircuit.config.json"
// The eval library's words for an import it cannot resolve without node_modules or a CDN.
const UNRESOLVED_IMPORT = /Cannot find module|Unresolved import/
const EVAL_IN_PACKAGE = ["node_modules", "@tscircuit", "eval", "dist", "eval", "index.js"]
const EVAL_HOISTED = ["..", "@tscircuit", "eval", "dist", "eval", "index.js"]

const defaultWorker: WorkerFactory = (evalEntry) =>
  new Worker(new URL("./eval-worker.js", import.meta.url), {
    workerData: { evalEntry },
    // A runaway circuit ends the worker, not the studio.
    resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
  })

export class Evaluator {
  private current: Started | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private nextId = 0
  private stopped = false
  private readonly createWorker: WorkerFactory
  private readonly timeoutMs: number
  private readonly maxProjectBytes: number
  private readonly buildsPerWorker: number

  constructor(
    private readonly evalEntry: string,
    options: EvaluatorOptions = {},
  ) {
    this.createWorker = options.createWorker ?? defaultWorker
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxProjectBytes = options.maxProjectBytes ?? MAX_PROJECT_BYTES
    this.buildsPerWorker = options.buildsPerWorker ?? DEFAULT_BUILDS_PER_WORKER
  }

  /** Starts loading tscircuit now, so the first build does not wait for it. */
  warm(): void {
    if (!this.stopped) this.start()
  }

  /**
   * Builds one circuit of the project; builds run one at a time. Rejects with
   * FastBuildUnavailable when `tsci build` should do it instead, and with a plain Error for a
   * mistake in the circuit code.
   */
  evaluate(root: string, file: string): Promise<unknown[]> {
    const run = this.queue.then(() => this.run(root, file))
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Ends the worker and refuses further builds. */
  async stop(): Promise<void> {
    this.stopped = true
    if (this.current) this.reset(this.current, new FastBuildUnavailable("The studio stopped"))
  }

  private async run(root: string, file: string): Promise<unknown[]> {
    const circuit = await resolveCircuit(root, file)
    if (existsSync(join(resolve(root), PROJECT_CONFIG))) throw new FastBuildUnavailable(`The project has a ${PROJECT_CONFIG}`)
    const fsMap = await collectProjectFiles(root, { maxBytes: this.maxProjectBytes })
    if (this.stopped) throw new FastBuildUnavailable("The studio stopped")
    const started = this.start()
    const id = ++this.nextId
    return new Promise<unknown[]>((done, fail) => {
      const timer = setTimeout(
        () => this.reset(started, new FastBuildUnavailable(`The build took longer than ${this.timeoutMs / 1000} s and was stopped`)),
        this.timeoutMs,
      )
      started.waiting.set(id, {
        done: (json) => {
          clearTimeout(timer)
          done(json)
        },
        fail: (error) => {
          clearTimeout(timer)
          fail(error)
        },
      })
      started.ready.then(
        () => {
          try {
            started.worker.postMessage({ id, fsMap, main: circuit.file })
          } catch (error) {
            this.reset(started, new FastBuildUnavailable(`The build could not be sent to the worker: ${(error as Error).message}`))
          }
        },
        () => undefined,
      )
    })
  }

  private start(): Started {
    if (this.current) return this.current
    const worker = this.createWorker(this.evalEntry)
    let markReady = () => {}
    let markFailed: (error: Error) => void = () => {}
    const ready = new Promise<void>((done, fail) => {
      markReady = done
      markFailed = fail
    })
    ready.catch(() => undefined)
    const started: Started = { worker, ready, waiting: new Map(), builds: 0 }
    const stop = (error: Error) => {
      markFailed(error)
      this.reset(started, error)
    }
    worker.on("message", (raw) => {
      const message = raw as WorkerMessage
      if (message.type === "ready") return markReady()
      if (message.type === "failed") return stop(new FastBuildUnavailable(`tscircuit could not be loaded: ${message.message}`))
      const waiter = started.waiting.get(message.id)
      if (!waiter) return
      started.waiting.delete(message.id)
      if (message.type === "error") {
        waiter.fail(UNRESOLVED_IMPORT.test(message.message) ? new FastBuildUnavailable(message.message) : new Error(message.message))
      } else if (Array.isArray(message.json)) {
        waiter.done(message.json)
      } else {
        waiter.fail(new FastBuildUnavailable("The build did not return circuit JSON"))
      }
      started.builds += 1
      if (started.builds >= this.buildsPerWorker) {
        this.reset(started, new FastBuildUnavailable("The worker was replaced"))
        this.warm()
      }
    })
    worker.on("error", (error) => stop(new FastBuildUnavailable(`The build worker failed: ${error.message}`)))
    worker.on("exit", () => stop(new FastBuildUnavailable("The build worker stopped")))
    this.current = started
    return started
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

/**
 * The eval library of the installed tscircuit CLI, so the editor builds with the same version
 * as `tsci build`: the first tsci on the PATH decides. COPPERFLOW_TSCIRCUIT_EVAL points at it
 * directly.
 */
export function findTscircuitEval(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const explicit = env.COPPERFLOW_TSCIRCUIT_EVAL
  if (explicit) return existsSync(explicit) ? resolve(explicit) : undefined
  const windows = platform === "win32"
  const shim = windows ? "tsci.cmd" : "tsci"
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH"
  // A relative entry would resolve against wherever the studio was started.
  const dir = (env[pathKey] ?? "").split(windows ? ";" : ":").find((d) => d && isAbsolute(d) && existsSync(join(d, shim)))
  if (!dir) return undefined
  const packages = [join(dir, "node_modules", "tscircuit"), join(dir, "..", "lib", "node_modules", "tscircuit")]
  try {
    packages.push(dirname(realpathSync(join(dir, shim))))
  } catch {
    // a broken link; the other candidates may still match
  }
  for (const pkg of packages) {
    for (const candidate of [join(pkg, ...EVAL_IN_PACKAGE), join(pkg, ...EVAL_HOISTED)]) {
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}
