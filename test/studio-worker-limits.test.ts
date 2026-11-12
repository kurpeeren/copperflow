import { describe, expect, test, vi } from "vitest"
import { EventEmitter } from "node:events"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveCircuit } from "../src/core/workspace.js"
import { buildDesign } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import { PLACE_WORKER_LIMIT_MS, PlaceRunner } from "../src/studio/place-runner.js"
import { ROUTE_WORKER_LIMIT_MS, RouteRunner } from "../src/studio/route-runner.js"

const BOARD = `export default () => (
  <board width="14mm" height="12mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-5} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={5} pcbY={0} />
    <trace from="R1.pin2" to="R2.pin1" />
  </board>
)
`

/** A worker that takes the request and never answers, as a run that never ends would. */
function stuckWorkers() {
  const made: { terminated: boolean }[] = []
  const factory = () => {
    const worker = Object.assign(new EventEmitter(), { terminated: false, postMessage: () => undefined })
    made.push(worker)
    return Object.assign(worker, { terminate: () => (worker.terminated = true) })
  }
  return { factory, made }
}

async function project() {
  const root = await mkdtemp(join(tmpdir(), "cf-limit-"))
  await writeFile(join(root, "main.circuit.tsx"), BOARD)
  const build = async (file: string) => buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), (await resolveCircuit(root, file)).file)
  return { root, build }
}

describe("the wall-clock cut of Studio runs in a worker", () => {
  test("the defaults are ten minutes for routing and the budget plus a minute for placing", () => {
    expect(ROUTE_WORKER_LIMIT_MS).toBe(600_000)
    expect(PLACE_WORKER_LIMIT_MS).toBe(80_000)
  })

  test("a routing run that never ends is cut, its worker ended, and the run reported failed", async () => {
    const { root, build } = await project()
    const workers = stuckWorkers()
    const events: { state: string; error?: string }[] = []
    const runner = new RouteRunner({ root, build, announce: (event) => events.push(event), nextMark: () => 1, requestBuild: () => undefined, createWorker: workers.factory as never, hosted: true, workerLimitMs: 100 })
    await runner.start("main.circuit.tsx", { kind: "all" })
    await vi.waitFor(() => expect(events.at(-1)?.state).toBe("failed"), { timeout: 5000 })
    expect(events.at(-1)?.error).toMatch(/router took longer than 0 s and was stopped/)
    expect(workers.made[0]?.terminated).toBe(true)
    expect(runner.running).toBeUndefined()
  })

  test("a placing run that never ends is cut the same way", async () => {
    const { root, build } = await project()
    const workers = stuckWorkers()
    const events: { state: string; error?: string }[] = []
    const runner = new PlaceRunner({ root, build, announce: (event) => events.push(event), nextMark: () => 1, requestBuild: () => undefined, createWorker: workers.factory as never, workerLimitMs: 100 })
    await runner.start("main.circuit.tsx", { kind: "all" })
    await vi.waitFor(() => expect(events.at(-1)?.state).toBe("failed"), { timeout: 5000 })
    expect(events.at(-1)?.error).toMatch(/placer took longer than 0 s and was stopped/)
    expect(workers.made[0]?.terminated).toBe(true)
  })
})
