import { EventEmitter } from "node:events"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { Engine, type EngineWorker } from "../../src/engine/engine.js"
import { CircuitCodeError } from "../../src/engine/evaluate.js"
import { BOARD } from "../fixtures.js"

type Fake = EventEmitter & EngineWorker & { terminated: boolean }
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-engine-"))
  await mkdir(join(root, "sub"), { recursive: true })
  await writeFile(join(root, "sub", "main.circuit.tsx"), BOARD.replace("./shared", "../shared"))
  await writeFile(join(root, "shared.ts"), `export const regulatorProps = { footprint: "sot23_5", pinCount: 5 }; export const offset = 1`)
  await writeFile(join(root, "bad.circuit.tsx"), "export default () => (<board")
})

/** A worker double that runs buildDesign in-process, as the real worker does. */
function fakeWorkers(mode: "build" | "silent" | "internal" = "build") {
  const created: Fake[] = []
  const factory = (): EngineWorker => {
    const worker = new EventEmitter() as Fake
    worker.terminated = false
    worker.postMessage = (raw: unknown) => {
      if (mode === "silent") return
      const { id, files, main } = raw as { id: number; files: Record<string, string>; main: string }
      setImmediate(() => {
        if (mode === "internal") return worker.emit("message", { id, error: { message: "boom", code: "internal" } })
        try {
          worker.emit("message", { id, design: buildDesign(files, main) })
        } catch (error) {
          const code = error instanceof CircuitCodeError ? "circuit-code" : "internal"
          worker.emit("message", { id, error: { message: (error as Error).message, code } })
        }
      })
    }
    worker.terminate = () => {
      worker.terminated = true
    }
    created.push(worker)
    return worker
  }
  return { created, factory }
}

/** Waits until the engine has started `count` workers. */
const workersStarted = (created: readonly unknown[], count: number) => vi.waitFor(() => expect(created).toHaveLength(count))

describe("Engine", () => {
  test("builds a file of the project and names it by its project path", async () => {
    const engine = new Engine({ createWorker: fakeWorkers().factory })
    const design = await engine.build(root, "sub/main.circuit.tsx")
    expect(design.file).toBe("sub/main.circuit.tsx")
    expect(design.circuit.components.length).toBeGreaterThan(0)
    await engine.stop()
  })

  test("resolves two builds in request order", async () => {
    const engine = new Engine({ createWorker: fakeWorkers().factory })
    const order: string[] = []
    const first = engine.build(root, "sub/main.circuit.tsx").then(() => order.push("first"))
    const second = engine.build(root, "sub/main.circuit.tsx").then(() => order.push("second"))
    await Promise.all([first, second])
    expect(order).toEqual(["first", "second"])
    await engine.stop()
  })

  test("rejects with a CircuitCodeError for circuit code mistakes", async () => {
    const engine = new Engine({ createWorker: fakeWorkers().factory })
    const error = await engine.build(root, "bad.circuit.tsx").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CircuitCodeError)
    await engine.stop()
  })

  test("rejects with a plain Error for internal errors", async () => {
    const engine = new Engine({ createWorker: fakeWorkers("internal").factory })
    const failure = await engine.build(root, "sub/main.circuit.tsx").catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(CircuitCodeError)
    expect((failure as Error).message).toBe("boom")
    await engine.stop()
  })

  test("refuses a file outside the project", async () => {
    const engine = new Engine({ createWorker: fakeWorkers().factory })
    await expect(engine.build(root, "../x.circuit.tsx")).rejects.toThrow(/outside the project root/)
    await engine.stop()
  })

  test("stops a build that takes too long and terminates the worker", async () => {
    const { created, factory } = fakeWorkers("silent")
    const engine = new Engine({ createWorker: factory, timeoutMs: 50 })
    await expect(engine.build(root, "sub/main.circuit.tsx")).rejects.toThrow(/took longer than/)
    expect(created[0]?.terminated).toBe(true)
    await engine.stop()
  })

  test("starts a new worker after the old one exits, and fails builds that were waiting", async () => {
    const { created, factory } = fakeWorkers("silent")
    const engine = new Engine({ createWorker: factory, timeoutMs: 5000 })
    const waiting = engine.build(root, "sub/main.circuit.tsx")
    await workersStarted(created, 1)
    created[0]?.emit("exit", 1)
    await expect(waiting).rejects.toThrow(/stopped/)
    const next = engine.build(root, "sub/main.circuit.tsx").catch(() => undefined)
    await workersStarted(created, 2)
    await engine.stop()
    await next
  })

  test("fails builds when the worker reports an error", async () => {
    const { created, factory } = fakeWorkers("silent")
    const engine = new Engine({ createWorker: factory, timeoutMs: 5000 })
    const waiting = engine.build(root, "sub/main.circuit.tsx")
    await workersStarted(created, 1)
    created[0]?.emit("error", new Error("out of memory"))
    await expect(waiting).rejects.toThrow(/out of memory/)
    await engine.stop()
  })

  test("refuses builds after stop", async () => {
    const engine = new Engine({ createWorker: fakeWorkers().factory })
    await engine.stop()
    await expect(engine.build(root, "sub/main.circuit.tsx")).rejects.toThrow(/stopped/)
  })

  test("reads the footprint file of a library part from disk", async () => {
    const circuit = `export default () => (<board width="10mm" height="10mm"><chip name="U1" footprint="parts/X/footprint.yaml" pinCount={2} /></board>)`
    const yaml = ["pads:", "  - { number: '1', shape: rect, x: -1, y: 0, width: 1, height: 1 }", "  - { number: '2', shape: rect, x: 1, y: 0, width: 1, height: 1 }", ""].join("\n")
    await mkdir(join(root, "parts", "X"), { recursive: true })
    await writeFile(join(root, "parts", "X", "part.yaml"), "title: X\n")
    await writeFile(join(root, "parts", "X", "footprint.yaml"), yaml)
    await writeFile(join(root, "disk.circuit.tsx"), circuit)
    const engine = new Engine({ createWorker: fakeWorkers().factory })
    const design = await engine.build(root, "disk.circuit.tsx")
    expect(design.pcb.parts[0]?.pads).toHaveLength(2)
    expect(design.diagnostics.filter((d) => d.code === "footprint")).toEqual([])
    await engine.stop()
  })
})
