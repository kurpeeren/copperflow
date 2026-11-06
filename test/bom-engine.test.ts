import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const engines = vi.hoisted(() => ({ stop: vi.fn(async () => undefined), build: vi.fn() }))
vi.mock("../src/engine/engine.js", () => ({ Engine: class { build = engines.build; stop = engines.stop } }))

const { buildBom } = await import("../src/core/bom.js")
const FILE = "main.circuit.tsx"
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-bom-engine-"))
  await writeFile(join(root, FILE), "export default () => <board />\n")
  engines.build.mockReset()
  engines.stop.mockClear()
})

afterEach(() => vi.restoreAllMocks())

describe("the engine buildBom starts itself", () => {
  test("is stopped after a build", async () => {
    engines.build.mockResolvedValue({ circuit: { components: [] } })
    expect(await buildBom(root, FILE)).toEqual([])
    expect(engines.stop).toHaveBeenCalledTimes(1)
  })

  test("is stopped when the build throws", async () => {
    engines.build.mockRejectedValue(new Error("main.circuit.tsx:1:1: bad"))
    await expect(buildBom(root, FILE)).rejects.toThrow("main.circuit.tsx:1:1: bad")
    expect(engines.stop).toHaveBeenCalledTimes(1)
  })
})
