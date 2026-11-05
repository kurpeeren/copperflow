import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { Design } from "../src/engine/design.js"
import { LiveProject, type DesignBuilder } from "../src/studio/live.js"

const FILE = "main.circuit.tsx"
const TEXT = "export default () => <board />\n"
const DESIGN = { version: 1, file: FILE } as unknown as Design
let root: string
let live: LiveProject | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-live-"))
  await writeFile(join(root, FILE), TEXT)
})

afterEach(() => live?.stop())

/** A builder whose builds finish only when the test releases them, in order. */
function heldBuilder() {
  const waiting: Array<() => void> = []
  const build = vi.fn(() => new Promise<Design>((done) => waiting.push(() => done(DESIGN))))
  return { builder: { build } satisfies DesignBuilder, build, release: () => waiting.shift()?.() }
}

describe("LiveProject", () => {
  test("currentDesign is the finished design while the circuit file is unchanged, and nothing otherwise", async () => {
    const held = heldBuilder()
    live = new LiveProject(root, held.builder)
    expect(await live.currentDesign(FILE)).toBeUndefined()
    live.requestBuild(FILE)
    await vi.waitFor(() => expect(held.build).toHaveBeenCalledTimes(1))
    expect(await live.currentDesign(FILE)).toBeUndefined()
    held.release()
    await vi.waitFor(() => expect(live?.getBuild(FILE).status).toBe("done"))
    expect(await live.currentDesign(FILE)).toBe(DESIGN)
    await writeFile(join(root, FILE), `${TEXT}// edited
`)
    expect(await live.currentDesign(FILE)).toBeUndefined()
  })

  test("a build requested while one runs runs once more afterwards, and finishes later", async () => {
    const held = heldBuilder()
    live = new LiveProject(root, held.builder)
    live.requestBuild(FILE)
    await vi.waitFor(() => expect(held.build).toHaveBeenCalledTimes(1))
    live.requestBuild(FILE)
    live.requestBuild(FILE)
    held.release()
    await vi.waitFor(() => expect(held.build).toHaveBeenCalledTimes(2))
    const first = live.getBuild(FILE).finishedAt
    held.release()
    await vi.waitFor(() => expect(live?.getBuild(FILE).status).toBe("done"))
    expect(held.build).toHaveBeenCalledTimes(2)
    expect(live.getBuild(FILE).finishedAt! > first!).toBe(true)
  })

  test("startedAt tells a build already running from the rerun that includes a later change", async () => {
    const held = heldBuilder()
    live = new LiveProject(root, held.builder)
    live.requestBuild(FILE)
    await vi.waitFor(() => expect(held.build).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 5))
    const changed = Date.now()
    live.requestBuild(FILE)
    held.release()
    await vi.waitFor(() => expect(held.build).toHaveBeenCalledTimes(2))
    const running = live.getBuild(FILE)
    expect(running.status).toBe("building")
    expect(Date.parse(running.startedAt ?? "")).toBeLessThan(changed)
    held.release()
    await vi.waitFor(() => expect(live?.getBuild(FILE).status).toBe("done"))
    const rerun = live.getBuild(FILE)
    expect(Date.parse(rerun.startedAt ?? "")).toBeGreaterThanOrEqual(changed)
    expect(Date.parse(rerun.finishedAt ?? "")).toBeGreaterThanOrEqual(Date.parse(rerun.startedAt ?? ""))
  })

  test("a failed build keeps the last design and does not show the project path", async () => {
    let fail = false
    live = new LiveProject(root, {
      build: async (at) => {
        if (fail) throw new Error(`${at}/${FILE}: boom`)
        return DESIGN
      },
    })
    live.requestBuild(FILE)
    await vi.waitFor(() => expect(live?.getBuild(FILE).status).toBe("done"))
    fail = true
    live.requestBuild(FILE)
    await vi.waitFor(() => expect(live?.getBuild(FILE).status).toBe("failed"))
    expect(live.getBuild(FILE)).toMatchObject({ design: DESIGN, error: `./${FILE}: boom` })
  })

  test("the watcher builds a changed file again, but not the text the last build started from", async () => {
    const build = vi.fn(async () => DESIGN)
    live = new LiveProject(root, { build })
    live.start()
    live.requestBuild(FILE)
    await vi.waitFor(() => expect(live?.getBuild(FILE).status).toBe("done"))
    await writeFile(join(root, FILE), TEXT)
    await new Promise((r) => setTimeout(r, 300))
    expect(build).toHaveBeenCalledTimes(1)
    await writeFile(join(root, FILE), `${TEXT}// changed\n`)
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(2))
  })

  test("nothing is built after the project stops", async () => {
    const build = vi.fn(async () => DESIGN)
    live = new LiveProject(root, { build })
    live.stop()
    live.requestBuild(FILE)
    await new Promise((r) => setTimeout(r, 50))
    expect(build).not.toHaveBeenCalled()
    expect(live.getBuild(FILE).status).toBe("idle")
  })
})
