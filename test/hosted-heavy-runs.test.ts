import { describe, expect, test, vi } from "vitest"
import { EventEmitter } from "node:events"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveCircuit } from "../src/core/workspace.js"
import { buildDesign } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import { autoplace } from "../src/mcp/place-tools.js"
import { autoroute } from "../src/mcp/route-tools.js"
import { acquireHeavyRun, HEAVY_RUN_BUSY, heavyRunHeld } from "../src/studio/heavy-runs.js"
import { PlaceRunner } from "../src/studio/place-runner.js"
import { RouteRunner } from "../src/studio/route-runner.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const BOARD = `export default () => (
  <board width="14mm" height="12mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-5} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={5} pcbY={0} />
    <trace from="R1.pin2" to="R2.pin1" />
  </board>
)
`

async function project() {
  const root = await mkdtemp(join(tmpdir(), "cf-heavy-"))
  await writeFile(join(root, "main.circuit.tsx"), BOARD)
  const build = async (file: string) => buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), (await resolveCircuit(root, file)).file)
  return { root, build }
}

/** A worker that takes the request and never answers. */
const stuck = () => Object.assign(new EventEmitter(), { postMessage: () => undefined, terminate: () => undefined })

describe("one routing or placement run per hosted workspace", () => {
  test("the slot is taken once and given back once", () => {
    const release = acquireHeavyRun("a")
    expect(heavyRunHeld()).toBe("a")
    expect(() => acquireHeavyRun("b")).toThrow(HEAVY_RUN_BUSY)
    release()
    release()
    expect(heavyRunHeld()).toBeUndefined()
    acquireHeavyRun("c")()
  })

  test("a Studio placement while a Studio routing run is going is refused, and the slot comes back when the run ends", async () => {
    const { root, build } = await project()
    const events: { state: string }[] = []
    const router = new RouteRunner({ root, build, announce: (event) => events.push(event), nextMark: () => 1, requestBuild: () => undefined, createWorker: stuck as never, hosted: true, workerLimitMs: 200 })
    const placer = new PlaceRunner({ root, build, announce: () => undefined, nextMark: () => 1, requestBuild: () => undefined, createWorker: stuck as never, hosted: { buildFiles: async () => Promise.reject(new Error("unused")) } })
    await router.start("main.circuit.tsx", { kind: "all" })
    expect(heavyRunHeld()).toBe("studio autoroute")
    await expect(placer.start("main.circuit.tsx", { kind: "all" })).rejects.toThrow(HEAVY_RUN_BUSY)
    await vi.waitFor(() => expect(events.at(-1)?.state).toBe("failed"), { timeout: 5000 })
    expect(heavyRunHeld()).toBeUndefined()
  })

  test("the agent's autoroute and autoplace go through the worker path when hosted, never this thread", async () => {
    const { root } = await project()
    const ports = { root, engine: inProcessEngine as never, hosted: true }
    const routed: unknown[] = []
    const placed: unknown[] = []
    await autoroute(ports, { file: "main.circuit.tsx", budgetSeconds: 2 }, {
      routeHosted: async (request) => {
        routed.push(request.budgetMs)
        throw new Error("stub worker")
      },
    }).catch((error: Error) => expect(error.message).toBe("stub worker"))
    await autoplace(ports, { file: "main.circuit.tsx", budgetSeconds: 3 }, {
      placeHosted: async (request) => {
        placed.push(request.budgetMs)
        throw new Error("stub worker")
      },
    }).catch((error: Error) => expect(error.message).toBe("stub worker"))
    expect(routed).toEqual([2000])
    expect(placed).toEqual([3000])
  })

  test("autoplace asks the worker for connectors ahead only with connectors: \"ahead\"", async () => {
    const { root } = await project()
    const ports = { root, engine: inProcessEngine as never, hosted: true }
    const asked: unknown[] = []
    const placeHosted = async (request: { connectorsAhead?: boolean }) => {
      asked.push(request.connectorsAhead)
      throw new Error("stub worker")
    }
    for (const connectors of [undefined, "last", "ahead"] as const) {
      await autoplace(ports, { file: "main.circuit.tsx", ...(connectors ? { connectors } : {}) }, { placeHosted: placeHosted as never }).catch((error: Error) => expect(error.message).toBe("stub worker"))
    }
    expect(asked).toEqual([undefined, undefined, true])
  })
})
