import { describe, expect, test } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildFilesWith, buildWith } from "../src/core/design-source.js"
import { sharedEngine, startWorkspace } from "../src/hosted/workspace.js"
import { generateTicketKeys } from "../src/hosted/ticket.js"
import type { Engine } from "../src/engine/engine.js"

/** An engine double that counts the builds it is asked for and never starts a worker. */
function countingEngine() {
  const calls = { build: 0, buildFiles: 0, stop: 0 }
  const engine = {
    build: async () => {
      calls.build += 1
      throw new Error("no build here")
    },
    buildFiles: async () => {
      calls.buildFiles += 1
      throw new Error("no build here")
    },
    stop: async () => void (calls.stop += 1),
  }
  return { engine: engine as unknown as Engine, calls }
}

describe("a hosted workspace has exactly one engine", () => {
  test("the Studio and the MCP server share one engine, made once and stopped when the workspace closes", async () => {
    const counting = countingEngine()
    let made = 0
    const extras = {
      createEngine: () => {
        made += 1
        return counting.engine
      },
    }
    expect(sharedEngine(extras).engine).toBe(counting.engine)
    made = 0
    const root = await mkdtemp(join(tmpdir(), "cf-one-engine-"))
    const workspace = await startWorkspace(
      { root, id: "p1", publicOrigin: "https://p1.ws.localhost", basePath: "", studioPort: 0, mcpPort: 0, bind: "127.0.0.1", ticketPublicKey: generateTicketKeys().publicKey },
      { ...extras, studio: { staticDir: root } },
    )
    await workspace.close()
    expect(made).toBe(1)
    expect(counting.calls.stop).toBe(1)
  })

  test("concurrent agent builds queue on the given engine and start no worker of their own", async () => {
    const counting = countingEngine()
    const builds = Array.from({ length: 4 }, () => buildFilesWith({ "a.circuit.tsx": "" }, "a.circuit.tsx", counting.engine).catch(() => undefined))
    const more = Array.from({ length: 3 }, () => buildWith("/nowhere", "a.circuit.tsx", counting.engine).catch(() => undefined))
    await Promise.all([...builds, ...more])
    expect(counting.calls.buildFiles).toBe(4)
    expect(counting.calls.build).toBe(3)
  })
})
