import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { EventEmitter } from "node:events"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Evaluator, FastBuildUnavailable, findTscircuitEval, type EvalWorker } from "../src/studio/evaluator.js"
import { LiveProject } from "../src/studio/live.js"
import { BOARD } from "./fixtures.js"

const FAKE_TSCI = [process.execPath, fileURLToPath(new URL("./fixtures/fake-tsci.mjs", import.meta.url))]
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-eval-"))
})

async function put(path: string, text = "x") {
  await mkdir(join(root, path, ".."), { recursive: true })
  await writeFile(join(root, path), text)
}

describe("findTscircuitEval", () => {
  const EVAL = ["@tscircuit", "eval", "dist", "eval", "index.js"]

  test("finds the eval library inside the tscircuit package next to the tsci shim on the PATH", async () => {
    await put("npm/tsci.cmd")
    await put(join("npm/node_modules/tscircuit/node_modules", ...EVAL))
    const found = findTscircuitEval({ PATH: `C:\\nowhere;${join(root, "npm")}` }, "win32")
    expect(found).toBe(join(root, "npm/node_modules/tscircuit/node_modules", ...EVAL))
  })

  test("finds a hoisted copy in a global lib folder, as npm lays it out on Unix", async () => {
    await put(process.platform === "win32" ? "prefix/bin/tsci.cmd" : "prefix/bin/tsci")
    await put(join("prefix/lib/node_modules", ...EVAL))
    expect(findTscircuitEval({ PATH: join(root, "prefix/bin") })).toBe(join(root, "prefix/lib/node_modules", ...EVAL))
  })

  test("the first tsci on the PATH decides, so the version matches tsci build", async () => {
    await put("first/tsci.cmd")
    await put("second/tsci.cmd")
    await put(join("second/node_modules/tscircuit/node_modules", ...EVAL))
    expect(findTscircuitEval({ PATH: `${join(root, "first")};${join(root, "second")}` }, "win32")).toBeUndefined()
  })

  test("an explicit path wins; relative PATH entries and missing installs give nothing", async () => {
    await put("custom/eval.js")
    expect(findTscircuitEval({ COPPERFLOW_TSCIRCUIT_EVAL: join(root, "custom/eval.js"), PATH: "" }, "linux")).toBe(join(root, "custom/eval.js"))
    await put("rel/tsci")
    await put(join("rel/node_modules/tscircuit/node_modules", ...EVAL))
    expect(findTscircuitEval({ PATH: "rel" }, "linux")).toBeUndefined()
    expect(findTscircuitEval({ PATH: join(root, "empty") }, "linux")).toBeUndefined()
  })
})

/** A worker double: answers each request with `reply(request)` once it has "loaded". */
function fakeWorkers(reply: (request: { id: number; main: string }) => unknown, opts: { loads?: boolean; silent?: boolean } = {}) {
  const created: Array<EventEmitter & EvalWorker & { terminated: boolean; posted: unknown[] }> = []
  const factory = () => {
    const worker = Object.assign(new EventEmitter(), {
      terminated: false,
      posted: [] as unknown[],
      postMessage(message: unknown) {
        worker.posted.push(message)
        const request = message as { id: number; main: string }
        if (!opts.silent) setTimeout(() => worker.emit("message", reply(request)), 5)
      },
      terminate() {
        worker.terminated = true
        return Promise.resolve(0)
      },
    })
    setTimeout(() => worker.emit("message", opts.loads === false ? { type: "failed", message: "no eval" } : { type: "ready" }), 1)
    created.push(worker)
    return worker
  }
  return { factory, created }
}

describe("Evaluator", () => {
  let evaluator: Evaluator | undefined
  afterEach(() => evaluator?.stop())

  test("sends the project files to the worker and returns its circuit JSON", async () => {
    await put("main.circuit.tsx", BOARD)
    const { factory, created } = fakeWorkers((r) => ({ type: "result", id: r.id, json: [{ type: "pcb_board" }] }))
    evaluator = new Evaluator("eval.js", { createWorker: factory })
    expect(await evaluator.evaluate(root, "main.circuit.tsx")).toEqual([{ type: "pcb_board" }])
    expect(created).toHaveLength(1)
    expect(created[0]?.posted[0]).toMatchObject({ main: "main.circuit.tsx", fsMap: { "main.circuit.tsx": BOARD } })
  })

  test("tells a mistake in the circuit apart from a build it cannot do", async () => {
    await put("main.circuit.tsx", BOARD)
    const failing = fakeWorkers((r) => ({ type: "error", id: r.id, message: "Unexpected token" }))
    evaluator = new Evaluator("eval.js", { createWorker: failing.factory })
    const codeError = await evaluator.evaluate(root, "main.circuit.tsx").catch((e: Error) => e)
    expect(codeError).toMatchObject({ message: "Unexpected token" })
    expect(codeError).not.toBeInstanceOf(FastBuildUnavailable)
    await evaluator.stop()

    const unresolved = fakeWorkers((r) => ({ type: "error", id: r.id, message: 'Cannot find module "left-pad". The package is not available' }))
    evaluator = new Evaluator("eval.js", { createWorker: unresolved.factory })
    await expect(evaluator.evaluate(root, "main.circuit.tsx")).rejects.toBeInstanceOf(FastBuildUnavailable)
    await evaluator.stop()

    evaluator = new Evaluator("eval.js", { createWorker: fakeWorkers(() => ({}), { loads: false }).factory })
    await expect(evaluator.evaluate(root, "main.circuit.tsx")).rejects.toThrow("no eval")
    await expect(evaluator.evaluate(root, "main.circuit.tsx")).rejects.toBeInstanceOf(FastBuildUnavailable)
  })

  test("leaves projects with a tscircuit.config.json to the CLI", async () => {
    await put("main.circuit.tsx", BOARD)
    await put("tscircuit.config.json", "{}")
    const { factory, created } = fakeWorkers((r) => ({ type: "result", id: r.id, json: [] }))
    evaluator = new Evaluator("eval.js", { createWorker: factory })
    await expect(evaluator.evaluate(root, "main.circuit.tsx")).rejects.toBeInstanceOf(FastBuildUnavailable)
    expect(created).toHaveLength(0)
  })

  test("after stop, a build in progress starts no worker and later builds are refused", async () => {
    await put("main.circuit.tsx", BOARD)
    const { factory, created } = fakeWorkers((r) => ({ type: "result", id: r.id, json: [] }))
    evaluator = new Evaluator("eval.js", { createWorker: factory })
    const running = evaluator.evaluate(root, "main.circuit.tsx")
    await evaluator.stop()
    await expect(running).rejects.toBeInstanceOf(FastBuildUnavailable)
    await expect(evaluator.evaluate(root, "main.circuit.tsx")).rejects.toBeInstanceOf(FastBuildUnavailable)
    evaluator.warm()
    expect(created).toHaveLength(0)
  })

  test("a worker that cannot take the request fails the build instead of hanging", async () => {
    await put("main.circuit.tsx", BOARD)
    const { factory } = fakeWorkers((r) => ({ type: "result", id: r.id, json: [] }))
    evaluator = new Evaluator("eval.js", {
      createWorker: () =>
        Object.assign(factory(), {
          postMessage() {
            throw new Error("could not be cloned")
          },
        }),
    })
    await expect(evaluator.evaluate(root, "main.circuit.tsx")).rejects.toThrow(/could not be cloned/)
  })

  test("replaces the worker after a number of builds", async () => {
    await put("main.circuit.tsx", BOARD)
    const { factory, created } = fakeWorkers((r) => ({ type: "result", id: r.id, json: [] }))
    evaluator = new Evaluator("eval.js", { createWorker: factory, buildsPerWorker: 2 })
    for (let i = 0; i < 3; i++) await evaluator.evaluate(root, "main.circuit.tsx")
    expect(created[0]?.terminated).toBe(true)
    expect(created[0]?.posted).toHaveLength(2)
    expect(created[1]?.posted).toHaveLength(1)
  })

  test("stops a build that takes too long and starts a fresh worker for the next one", async () => {
    await put("main.circuit.tsx", BOARD)
    const { factory, created } = fakeWorkers(() => ({}), { silent: true })
    evaluator = new Evaluator("eval.js", { createWorker: factory, timeoutMs: 30 })
    await expect(evaluator.evaluate(root, "main.circuit.tsx")).rejects.toThrow(/longer than/)
    expect(created[0]?.terminated).toBe(true)
    await expect(evaluator.evaluate(root, "main.circuit.tsx")).rejects.toThrow(/longer than/)
    expect(created).toHaveLength(2)
  })

  test("runs one build at a time and refuses files outside the project", async () => {
    await put("main.circuit.tsx", BOARD)
    const { factory, created } = fakeWorkers(() => ({}), { silent: true })
    evaluator = new Evaluator("eval.js", { createWorker: factory })
    const first = evaluator.evaluate(root, "main.circuit.tsx")
    const second = evaluator.evaluate(root, "main.circuit.tsx")
    const posted = () => created[0]?.posted ?? []
    const answer = (index: number) => created[0]?.emit("message", { type: "result", id: (posted()[index] as { id: number }).id, json: [index] })
    await vi.waitFor(() => expect(posted()).toHaveLength(1))
    await new Promise((done) => setTimeout(done, 30))
    expect(posted()).toHaveLength(1)
    answer(0)
    await vi.waitFor(() => expect(posted()).toHaveLength(2))
    answer(1)
    expect(await Promise.all([first, second])).toEqual([[0], [1]])
    await expect(evaluator.evaluate(root, "../outside.circuit.tsx")).rejects.toThrow()
  })
})

describe("LiveProject with a fast evaluator", () => {
  function buildOnce(live: LiveProject, file: string) {
    return new Promise<void>((done) => {
      const off = live.subscribe((event, data) => {
        if (event === "build" && data.status !== "building") {
          off()
          done()
        }
      })
      live.requestBuild(file)
    })
  }

  test("uses the evaluator and reads errors and warnings from its circuit JSON", async () => {
    await put("main.circuit.tsx", BOARD)
    const json = [{ type: "pcb_board" }, { type: "pcb_trace_error", message: "too close" }]
    const live = new LiveProject(root, FAKE_TSCI, { evaluate: async () => json })
    await buildOnce(live, "main.circuit.tsx")
    const build = live.getBuild("main.circuit.tsx")
    expect(build.status).toBe("done")
    expect(build.circuitJson).toEqual(json)
    expect(build.report?.errors).toEqual([{ type: "pcb_trace_error", count: 1, messages: ["too close"] }])
  })

  test("falls back to the tscircuit CLI when the fast build cannot run", async () => {
    await put("main.circuit.tsx", BOARD)
    await put("main.circuit.fake.json", JSON.stringify({ elements: [{ type: "schematic_box" }] }))
    const live = new LiveProject(root, FAKE_TSCI, {
      evaluate: async () => {
        throw new FastBuildUnavailable('Cannot find module "left-pad"')
      },
    })
    await buildOnce(live, "main.circuit.tsx")
    expect(live.getBuild("main.circuit.tsx").circuitJson).toEqual([{ type: "schematic_box" }])
  })

  test("shows a mistake in the circuit code at once, without its debug log and without the CLI", async () => {
    await put("main.circuit.tsx", BOARD)
    await put("main.circuit.fake.json", JSON.stringify({ elements: [{ type: "schematic_box" }] }))
    const live = new LiveProject(root, FAKE_TSCI, {
      evaluate: async () => {
        throw new Error("Unexpected token (3:4)\n\n[debug] resolved imports …")
      },
    })
    await buildOnce(live, "main.circuit.tsx")
    expect(live.getBuild("main.circuit.tsx")).toMatchObject({ status: "failed", error: "Unexpected token (3:4)" })
    expect(live.getBuild("main.circuit.tsx").circuitJson).toBeUndefined()
  })
})
