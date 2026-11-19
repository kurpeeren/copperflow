import { describe, expect, test, vi } from "vitest"
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import type { StudioLink } from "../src/mcp/studio-activity.js"
import { activityLine, callActivity, NO_PROGRESS, nextProgress, TICK_MS, type ProgressNumbers } from "../src/mcp/tool-activity.js"
import type { AgentActivity } from "../src/studio/activity-event.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "main.circuit.tsx"
const resistor = (name: string, x: number) => `    <resistor name="${name}" resistance="1k" footprint="0603" pcbX={${x}} pcbY={0} />`
const TWO = `export default () => (
  <board width="14mm" height="10mm">
${resistor("R1", -4)}
${resistor("R2", 4)}
    <trace from=".R1 > .pin2" to="net.A" />
    <trace from=".R2 > .pin1" to="net.A" />
  </board>
)
`

/** The notifications a run of counts and steps sends, from a fresh state. */
function sent(ticks: Array<[number, number] | undefined>): Array<{ progress: number; total?: number }> {
  let state: ProgressNumbers = NO_PROGRESS
  const out: Array<{ progress: number; total?: number }> = []
  for (const tick of ticks) {
    const next = tick === undefined ? nextProgress(state) : nextProgress(state, tick[0], tick[1])
    state = next.state
    if (next.send) out.push(next.send)
  }
  return out
}

describe("progress numbers", () => {
  test("a count is sent as it is, with its total", () => {
    expect(sent([[1, 8], [2, 8], [8, 8]])).toEqual([{ progress: 1, total: 8 }, { progress: 2, total: 8 }, { progress: 8, total: 8 }])
  })

  test("a count that starts again (the next pass) goes on after what was sent, its total moved with it", () => {
    expect(sent([[7, 8], [1, 3], [3, 3]])).toEqual([{ progress: 7, total: 8 }, { progress: 8, total: 10 }, { progress: 10, total: 10 }])
  })

  test("a step is one more; a count after it starts after the step", () => {
    expect(sent([undefined, [1, 4], undefined])).toEqual([{ progress: 1 }, { progress: 2, total: 5 }, { progress: 3 }])
  })

  test("a count of 0 after a step sends nothing, as it would not grow", () => {
    expect(sent([undefined, [0, 4], [1, 4]])).toEqual([{ progress: 1 }, { progress: 2, total: 5 }])
  })

  test("a count told again with the same numbers does not move the progress; only a lower one starts a new pass", () => {
    expect(sent([[3, 8], [3, 8], [3, 8], [5, 8]])).toEqual([{ progress: 3, total: 8 }, { progress: 5, total: 8 }])
    expect(sent([[3, 8], [3, 8], [2, 8]])).toEqual([{ progress: 3, total: 8 }, { progress: 5, total: 11 }])
  })

  test("the total never shrinks from one notification to the next", () => {
    const totals = sent([[1, 20], [2, 3], [3, 3], [1, 2], [4, 6]]).map((one) => one.total ?? 0)
    expect(totals).toEqual([...totals].sort((a, b) => a - b))
    expect(totals[1]).toBe(20)
  })
})

describe("the activity line", () => {
  test("names the tool and what it works on", () => {
    expect(activityLine("autoroute", { file: "amp.circuit.tsx", budgetSeconds: 5 })).toBe("autoroute amp.circuit.tsx")
    expect(activityLine("part_info", { id: "ne555" })).toBe("part_info ne555")
    expect(activityLine("project_status", {})).toBe("project_status")
    expect(activityLine("list_parts", undefined)).toBe("list_parts")
    expect(activityLine("autoroute", { file: "x".repeat(200) })).toHaveLength("autoroute ".length + 80)
  })
})

describe("one call's activity", () => {
  function channels(progressToken: string | undefined, studioOpen: boolean) {
    let clock = 0
    const client: Array<{ progress: number; total?: number; message: string }> = []
    const studio: AgentActivity[] = []
    const link: StudioLink = { present: async () => studioOpen, tell: (one) => studio.push(one), settled: async () => undefined }
    const activity = callActivity({ tool: "autoroute", progressToken, notify: (one) => client.push(one), studio: link, studioOpen, now: () => clock })
    return { activity, client, studio, tick: (ms: number) => (clock += ms) }
  }

  test("counts are told at most every TICK_MS, the last of a count always", () => {
    const { activity, client, tick } = channels("t1", false)
    activity.reporter.count("Routing: 1 of 3 connections, pass 1", 1, 3)
    tick(TICK_MS - 1)
    activity.reporter.count("Routing: 2 of 3 connections, pass 1", 2, 3)
    activity.reporter.count("Routing: 3 of 3 connections, pass 1", 3, 3)
    tick(1)
    activity.reporter.step("Writing the copper")
    expect(client.map((one) => one.message)).toEqual(["Routing: 1 of 3 connections, pass 1", "Routing: 3 of 3 connections, pass 1", "Writing the copper"])
  })

  test("the Studio hears the start, the raw counts and the end; the client only the steps", () => {
    const { activity, client, studio } = channels("t1", true)
    activity.start("autoroute main.circuit.tsx")
    activity.reporter.count("Routing: 2 of 8 connections, pass 1", 2, 8)
    activity.end(true, "autoroute main.circuit.tsx")
    expect(studio).toEqual([
      { tool: "autoroute", message: "autoroute main.circuit.tsx", state: "running" },
      { tool: "autoroute", message: "Routing: 2 of 8 connections, pass 1", state: "running", progress: 2, total: 8 },
      { tool: "autoroute", message: "autoroute main.circuit.tsx", state: "done" },
    ])
    expect(client).toEqual([{ progress: 2, total: 8, message: "Routing: 2 of 8 connections, pass 1" }])
  })

  test("nobody listening: the reporter is not heard and tells nothing", () => {
    const { activity, client, studio } = channels(undefined, false)
    expect(activity.reporter.heard).toBe(false)
    activity.start("x")
    activity.reporter.step("y")
    activity.end(false, "z")
    expect([client, studio]).toEqual([[], []])
  })
})

describe("tool calls through the server", () => {
  async function connect(studio: AgentActivity[]) {
    const root = await mkdtemp(join(tmpdir(), "cf-activity-"))
    await writeFile(join(root, FILE), TWO)
    const link: StudioLink = { present: async () => true, tell: (one) => studio.push(one), settled: async () => undefined }
    const server = createCopperflowServer(root, { engine: inProcessEngine, studio: link })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: "test", version: "0.0.0" })
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
    return Object.assign(client, { root })
  }

  test("autoroute tells its steps to a client that asked for progress, and the Studio its start and end", async () => {
    const studio: AgentActivity[] = []
    const client = await connect(studio)
    const progress: Array<{ progress: number; message?: string }> = []
    const result = await client.callTool({ name: "autoroute", arguments: { file: FILE } }, undefined, { onprogress: (one) => progress.push(one) })
    expect(result.isError).not.toBe(true)
    expect(progress.map((one) => one.message)).toEqual(["Building the board", "Routing the connections", "Writing the copper", "Checking the new copper"])
    expect(progress.map((one) => one.progress)).toEqual([1, 2, 3, 4])
    expect(studio[0]).toEqual({ tool: "autoroute", message: "autoroute main.circuit.tsx", state: "running" })
    expect(studio.at(-1)).toEqual({ tool: "autoroute", message: "autoroute main.circuit.tsx", state: "done" })
  })

  test("a client that cancels autoroute: the call ends saying so, and nothing is written", async () => {
    const studio: AgentActivity[] = []
    const client = await connect(studio)
    const root = client.root
    const before = await readdir(root, { recursive: true })
    const text = await readFile(join(root, FILE), "utf8")
    const cancel = new AbortController()
    const call = client.callTool({ name: "autoroute", arguments: { file: FILE } }, undefined, { signal: cancel.signal, onprogress: () => cancel.abort() })
    await expect(call).rejects.toThrow()
    await vi.waitFor(() => expect(studio.at(-1)?.state).toBe("failed"))
    expect(studio.at(-1)?.message).toBe("autoroute main.circuit.tsx: The router run was cancelled. Nothing was written.")
    expect(await readdir(root, { recursive: true })).toEqual(before)
    expect(await readFile(join(root, FILE), "utf8")).toBe(text)
  })

  test("every tool says it started and ended; a refused call says why", async () => {
    const studio: AgentActivity[] = []
    const client = await connect(studio)
    await client.callTool({ name: "list_circuits", arguments: {} })
    await client.callTool({ name: "remove_part", arguments: { file: FILE, part: "R9" } })
    expect(studio.slice(0, 2)).toEqual([
      { tool: "list_circuits", message: "list_circuits", state: "running" },
      { tool: "list_circuits", message: "list_circuits", state: "done" },
    ])
    expect(studio[3]?.state).toBe("failed")
    expect(studio[3]?.message).toMatch(/^remove_part main\.circuit\.tsx: .*R9/)
  })
})
