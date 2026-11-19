import { describe, expect, test, vi } from "vitest"
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { placeBoard } from "../src/engine/pcb-place/index.js"
import { routeBoard } from "../src/engine/router/route-board.js"
import { autoplace } from "../src/mcp/place-tools.js"
import { autoroute } from "../src/mcp/route-tools.js"
import { placeTold, routeTold, tellPlace, tellRoute } from "../src/mcp/told-runs.js"
import { QUIET, type Reporter } from "../src/mcp/tool-activity.js"
import { RunCancelled, runInWorker, WorkerFailure, type RunWorker } from "../src/mcp/worker-run.js"
import type { PlaceWorkerFactory } from "../src/studio/place-runner.js"
import { routeInput, type RouteWorkerFactory } from "../src/studio/route-runner.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "main.circuit.tsx"
const resistor = (name: string, place: string) => `    <resistor name="${name}" resistance="1k" footprint="0603" ${place}/>`
const board = (body: string[]) => `export default () => (
  <board width="20mm" height="12mm">
${body.join("\n")}
    <trace from=".R1 > .pin2" to="net.A" />
    <trace from=".R2 > .pin1" to="net.A" />
    <trace from=".R3 > .pin2" to="net.B" />
    <trace from=".R4 > .pin1" to="net.B" />
  </board>
)
`
const PLACED = board([resistor("R1", "pcbX={-6} pcbY={-3} "), resistor("R2", "pcbX={6} pcbY={-3} "), resistor("R3", "pcbX={-6} pcbY={3} "), resistor("R4", "pcbX={6} pcbY={3} ")])
const UNPLACED = board(["R1", "R2", "R3", "R4"].map((name) => resistor(name, "")))

async function designOf(text: string) {
  const root = await mkdtemp(join(tmpdir(), "cf-told-"))
  await writeFile(join(root, FILE), text)
  return inProcessEngine.build(root, FILE)
}

/** A reporter that writes down what it hears. */
function listening(): Reporter & { heard: true; lines: string[] } {
  const lines: string[] = []
  return { heard: true, lines, step: (message) => lines.push(message), count: (message) => lines.push(message) }
}

type Listener = (message: never) => void
/** A worker double: runs `work` on the request after it is posted, sending what `work` sends. */
function double(work: (request: never, send: (reply: unknown) => void) => void) {
  const listeners = new Map<string, Listener>()
  const worker = {
    terminated: false,
    postMessage: (request: never) => setImmediate(() => work(request, (reply) => listeners.get("message")?.(reply as never))),
    on: (event: string, listener: Listener) => listeners.set(event, listener),
    terminate: () => ((worker.terminated = true), undefined),
    emit: (event: string, value: unknown) => listeners.get(event)?.(value as never),
  }
  return worker
}

describe("routing told", () => {
  test("in a worker, each pass's progress is told while it routes, and the report is the router's", async () => {
    const design = await designOf(PLACED)
    const made: Array<ReturnType<typeof double>> = []
    const factory = (() => {
      const one = double((request: { input: never; scope: never; budgetMs: number }, send) => {
        const report = routeBoard(request.input, { scope: request.scope, budgetMs: request.budgetMs, onProgress: (progress) => send({ type: "progress", progress }) })
        send({ type: "done", report })
      })
      made.push(one)
      return one
    }) as unknown as RouteWorkerFactory
    const report = listening()
    const told = await routeTold(routeInput(design), { scope: { kind: "all" }, budgetMs: 10_000, worker: factory }, report)
    expect(told.result.routed).toHaveLength(2)
    expect(told.note).toBeUndefined()
    expect(report.lines).toContain("Routing: 1 of 2 connections, pass 1")
    expect(report.lines.at(-1)).toBe("Tidying the routes")
    expect(made[0]?.terminated).toBe(true)
  })

  test("nobody listening, or a test's clock: the run stays in this process and tells nothing", async () => {
    const design = await designOf(PLACED)
    const never = (() => {
      throw new Error("no worker wanted")
    }) as unknown as RouteWorkerFactory
    expect((await routeTold(routeInput(design), { scope: { kind: "all" }, budgetMs: 10_000, worker: never }, QUIET)).result.routed).toHaveLength(2)
    const report = listening()
    await routeTold(routeInput(design), { scope: { kind: "all" }, budgetMs: 10_000, worker: never, clock: () => performance.now() }, report)
    expect(report.lines).toEqual(["Routing the connections"])
  })

  test("the lines it tells", () => {
    const report = listening()
    tellRoute(report, { stage: "routing", pass: 2, done: 1, total: 1 })
    tellRoute(report, { stage: "cleanup", capped: false })
    tellPlace(report, { stage: "construct", done: 3, total: 12 })
    tellPlace(report, { stage: "refine", done: 2, total: 5 })
    expect(report.lines).toEqual(["Routing: 1 of 1 connection, pass 2", "Tidying the routes", "Placing: 3 of 12 parts", "Placing: refining, 40%"])
  })
})

describe("placing told", () => {
  test("in a worker, without fit; with fit, in this process", async () => {
    const design = await designOf(UNPLACED)
    const factory = (() =>
      double((request: { design: never; scope: never; locked: string[]; budgetMs: number }, send) => {
        const placement = placeBoard(request.design, { scope: request.scope, locked: request.locked, budgetMs: request.budgetMs, onProgress: (progress) => send({ type: "progress", progress }) })
        send({ type: "done", placement })
      })) as unknown as PlaceWorkerFactory
    const run = { scope: { kind: "all" as const }, locked: [], budgetMs: 10_000, connectorsAhead: false, worker: factory }
    const report = listening()
    const placed = await placeTold(design, { ...run, fit: false }, report)
    expect(placed.result.positions.size).toBe(4)
    expect(report.lines.some((line) => line.startsWith("Placing: "))).toBe(true)
    const fitted = listening()
    await placeTold(design, { ...run, fit: true, worker: (() => { throw new Error("no worker wanted") }) as unknown as PlaceWorkerFactory }, fitted)
    expect(fitted.lines).toEqual(["Placing the parts and fitting the board"])
  })
})

describe("a run in a worker", () => {
  const job = (limitMs = 10_000, signal?: AbortSignal) => ({ request: {}, progress: () => undefined, result: (reply: { value: number }) => reply.value, limitMs, what: "router", signal })
  const started = (worker: unknown) => () => worker as RunWorker<object, never>

  test("its error, its stop and its limit end it with a plain message", async () => {
    const failing = double((_request, send) => send({ type: "error", message: "no room" }))
    const refused = runInWorker(started(failing), job())
    await expect(refused).rejects.toThrow("no room")
    await expect(refused).rejects.not.toBeInstanceOf(WorkerFailure)
    const stopping = double(() => undefined)
    const stopped = runInWorker(started(stopping), job())
    stopping.emit("exit", 1)
    await expect(stopped).rejects.toThrow("The router worker stopped")
    await expect(stopped).rejects.toBeInstanceOf(WorkerFailure)
    const crashing = double(() => undefined)
    const crashed = runInWorker(started(crashing), job())
    crashing.emit("error", new Error("out of memory"))
    await expect(crashed).rejects.toThrow("The router worker failed: out of memory")
    await expect(crashed).rejects.toBeInstanceOf(WorkerFailure)
    const slow = double(() => undefined)
    await expect(runInWorker(started(slow), job(5))).rejects.toThrow("The router took longer than 0 s and was stopped. Nothing was written.")
    expect(slow.terminated).toBe(true)
  })

  test("a board that cannot be sent, or a worker that cannot start, is a failure of the worker", async () => {
    const refusing = { ...double(() => undefined), postMessage: () => { throw new Error("could not be cloned") } }
    const unsent = runInWorker(started(refusing), job())
    await expect(unsent).rejects.toThrow("The board could not be sent to the router worker: could not be cloned")
    await expect(unsent).rejects.toBeInstanceOf(WorkerFailure)
    const cannot = () => {
      throw new Error("no threads")
    }
    const unstarted = runInWorker(cannot as () => RunWorker<object, never>, job())
    await expect(unstarted).rejects.toThrow("The router worker could not start: no threads")
    await expect(unstarted).rejects.toBeInstanceOf(WorkerFailure)
  })

  test("a progress listener that throws is written to stderr once and the run goes on", async () => {
    const lines: string[] = []
    const write = vi.spyOn(process.stderr, "write").mockImplementation((text) => (lines.push(String(text)), true))
    try {
      const counting = double((_request, send) => {
        send({ type: "progress", progress: 1 })
        send({ type: "progress", progress: 2 })
        send({ type: "done", value: 7 })
      })
      const throwing = { ...job(), progress: () => { throw new Error("client gone") } }
      await expect(runInWorker(started(counting), throwing)).resolves.toBe(7)
    } finally {
      write.mockRestore()
    }
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/router.*client gone/)
  })

  test("a cancel ends the worker and says nothing was written; a run cancelled before it starts starts no worker", async () => {
    const cancel = new AbortController()
    const waiting = double(() => undefined)
    const run = runInWorker(started(waiting), job(10_000, cancel.signal))
    cancel.abort()
    await expect(run).rejects.toThrow("The router run was cancelled. Nothing was written.")
    await expect(run).rejects.toBeInstanceOf(RunCancelled)
    expect(waiting.terminated).toBe(true)
    let made = false
    const never = () => ((made = true), double(() => undefined)) as unknown as RunWorker<object, never>
    await expect(runInWorker(never, job(10_000, cancel.signal))).rejects.toBeInstanceOf(RunCancelled)
    expect(made).toBe(false)
  })
})

describe("a worker that fails runs the job in this process", () => {
  const stops = (() => {
    const one = double(() => one.emit("exit", 1))
    return one
  }) as unknown as RouteWorkerFactory

  test("the router: the report is the in-process one, with a note that says why", async () => {
    const design = await designOf(PLACED)
    const told = await routeTold(routeInput(design), { scope: { kind: "all" }, budgetMs: 10_000, worker: stops }, listening())
    expect(told.result.routed).toHaveLength(2)
    expect(told.note).toBe("The router ran in this process because its worker failed (it stopped with exit code 1).")
    const cannot = (() => {
      throw new Error("no threads")
    }) as unknown as RouteWorkerFactory
    const again = await routeTold(routeInput(design), { scope: { kind: "all" }, budgetMs: 10_000, worker: cannot }, listening())
    expect(again.note).toMatch(/because its worker failed \(it could not start: no threads\)/)
  })

  test("the placer too", async () => {
    const design = await designOf(UNPLACED)
    const told = await placeTold(design, { scope: { kind: "all" }, locked: [], budgetMs: 10_000, connectorsAhead: false, fit: false, worker: stops as unknown as PlaceWorkerFactory }, listening())
    expect(told.result.positions.size).toBe(4)
    expect(told.note).toMatch(/^The placer ran in this process because its worker failed/)
  })

  test("a job that failed on its own terms is not run again", async () => {
    const design = await designOf(PLACED)
    const refusing = (() => double((_request, send) => send({ type: "error", message: "the board has no outline" }))) as unknown as RouteWorkerFactory
    await expect(routeTold(routeInput(design), { scope: { kind: "all" }, budgetMs: 10_000, worker: refusing }, listening())).rejects.toThrow("the board has no outline")
  })
})

describe("a cancelled autoroute or autoplace writes nothing", () => {
  async function project(text: string) {
    const root = await mkdtemp(join(tmpdir(), "cf-cancel-"))
    await writeFile(join(root, FILE), text)
    const files = async () => Object.fromEntries(await Promise.all((await readdir(root, { recursive: true })).map(async (name) => [name, await readFile(join(root, name), "utf8").catch(() => "(folder)")])))
    return { ports: { root, engine: inProcessEngine }, files }
  }
  /** A reporter that cancels when it hears `step`. */
  function cancelsAt(step: string, cancel: AbortController): Reporter {
    return { heard: true, step: (message) => (message === step ? cancel.abort() : undefined), count: () => undefined }
  }

  test("autoroute cancelled while its worker routes: the worker is ended and the answer says so", async () => {
    const { ports, files } = await project(PLACED)
    const before = await files()
    const cancel = new AbortController()
    const made: Array<ReturnType<typeof double>> = []
    const waiting = (() => {
      const one = double(() => cancel.abort())
      made.push(one)
      return one
    }) as unknown as RouteWorkerFactory
    await expect(autoroute(ports, { file: FILE }, { report: listening(), worker: waiting, signal: cancel.signal })).rejects.toThrow("cancelled. Nothing was written.")
    expect(made[0]?.terminated).toBe(true)
    expect(await files()).toEqual(before)
  })

  test("autoroute cancelled after the routing, before the write: nothing is written", async () => {
    const { ports, files } = await project(PLACED)
    const before = await files()
    const cancel = new AbortController()
    await expect(autoroute(ports, { file: FILE }, { report: cancelsAt("Writing the copper", cancel), worker: null, signal: cancel.signal })).rejects.toThrow("cancelled. Nothing was written.")
    expect(await files()).toEqual(before)
  })

  test("autoplace cancelled before the write: nothing is written", async () => {
    const { ports, files } = await project(UNPLACED)
    const before = await files()
    const cancel = new AbortController()
    await expect(autoplace(ports, { file: FILE }, { report: cancelsAt("Writing the positions", cancel), worker: null, signal: cancel.signal })).rejects.toThrow("cancelled. Nothing was written.")
    expect(await files()).toEqual(before)
  })
})
