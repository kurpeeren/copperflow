// One router or placer run in a worker thread for the agent's tools, so their progress can leave this process while the
// run goes on: in the process, the run is synchronous and a progress notification would only go out after it ended.
// The workers are the Studio's (router-worker.ts, place-worker.ts); one is started per run and ended afterwards.

/** The replies both workers send: progress while they work, then the result or why they failed. */
export type WorkerReply<P, D> = { type: "progress"; progress: P } | ({ type: "done" } & D) | { type: "error"; message: string }

export interface RunWorker<Request, Reply> {
  postMessage(message: Request): void
  on(event: "message", listener: (message: Reply) => void): unknown
  on(event: "error", listener: (error: Error) => void): unknown
  on(event: "exit", listener: (code: number) => void): unknown
  terminate(): unknown
}

/** How long past its own budget a run may take (its cleanup) before the worker is ended. */
export const WORKER_GRACE_MS = 60_000

/**
 * The worker itself failed (it could not start, ran out of memory, stopped, or never got the board), not the job: the
 * same job can then run in this process. `reason` says why, for the tool's answer.
 */
export class WorkerFailure extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message)
    this.name = "WorkerFailure"
  }
}

/** The client cancelled the call: the run was ended and nothing was written. */
export class RunCancelled extends Error {
  constructor(what: string) {
    super(`The ${what} run was cancelled. Nothing was written.`)
    this.name = "RunCancelled"
  }
}

/** Throws RunCancelled when `signal` has been aborted; a tool calls it before each step that writes. */
export function throwIfCancelled(signal: AbortSignal | undefined, what: string): void {
  if (signal?.aborted) throw new RunCancelled(what)
}

export interface WorkerJob<Request, P, D, Result> {
  request: Request
  /** Hears each progress reply. */
  progress(progress: P): void
  /** The result a "done" reply carries. */
  result(reply: D): Result
  /** The worker is ended after this. */
  limitMs: number
  /** "router" or "placer", for the errors. */
  what: string
  /** Aborted when the client cancels the call: the worker is ended and the run fails with RunCancelled. */
  signal?: AbortSignal | undefined
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Starts the worker, or the failure that says it could not be started. */
function startWorker<W>(start: () => W, what: string): W | WorkerFailure {
  try {
    return start()
  } catch (error) {
    return new WorkerFailure(`The ${what} worker could not start: ${messageOf(error)}`, `it could not start: ${messageOf(error)}`)
  }
}

/**
 * Runs one job in a worker that `start` makes, and ends the worker when the job ends, fails, runs past its limit or is
 * cancelled. A failure of the worker itself rejects with WorkerFailure; the job's own error with a plain Error.
 */
export function runInWorker<Request, P, D, Result>(start: () => RunWorker<Request, WorkerReply<P, D>>, job: WorkerJob<Request, P, D, Result>): Promise<Result> {
  return new Promise((done, fail) => {
    if (job.signal?.aborted) return fail(new RunCancelled(job.what))
    const worker = startWorker(start, job.what)
    if (worker instanceof WorkerFailure) return fail(worker)
    let settled = false
    const settle = (finish: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(cap)
      job.signal?.removeEventListener("abort", cancel)
      void worker.terminate()
      finish()
    }
    const cancel = () => settle(() => fail(new RunCancelled(job.what)))
    const cap = setTimeout(() => settle(() => fail(new Error(`The ${job.what} took longer than ${Math.round(job.limitMs / 1000)} s and was stopped. Nothing was written.`))), job.limitMs)
    job.signal?.addEventListener("abort", cancel, { once: true })
    const progress = progressTeller(job)
    worker.on("message", (reply) => {
      if (reply.type === "progress") return settled ? undefined : progress(reply.progress)
      if (reply.type === "done") return settle(() => finishWith(() => job.result(reply), done, fail))
      settle(() => fail(new Error(reply.message)))
    })
    worker.on("error", (error) => settle(() => fail(new WorkerFailure(`The ${job.what} worker failed: ${error.message}`, error.message))))
    worker.on("exit", (code) => settle(() => fail(new WorkerFailure(`The ${job.what} worker stopped (exit code ${code})`, `it stopped with exit code ${code}`))))
    try {
      worker.postMessage(job.request)
    } catch (error) {
      settle(() => fail(new WorkerFailure(`The board could not be sent to the ${job.what} worker: ${messageOf(error)}`, `the board could not be sent to it: ${messageOf(error)}`)))
    }
  })
}

/** The job's result, or its failure: a throw inside the worker's listener would otherwise escape this process's handlers. */
function finishWith<Result>(result: () => Result, done: (value: Result) => void, fail: (error: unknown) => void): void {
  try {
    done(result())
  } catch (error) {
    fail(error)
  }
}

/**
 * Tells the job's progress. A listener that throws (a client that went away) must not become an uncaught exception,
 * which ends a stdio MCP server: the first such failure is written to stderr (later ones are not repeated) and the
 * run goes on.
 */
function progressTeller<P>(job: { progress(progress: P): void; what: string }): (progress: P) => void {
  let warned = false
  return (progress) => {
    try {
      job.progress(progress)
    } catch (error) {
      if (warned) return
      warned = true
      process.stderr.write(`copperflow: telling the ${job.what}'s progress failed, the run goes on: ${messageOf(error)}\n`)
    }
  }
}
