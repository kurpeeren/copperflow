import { beforeEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { collectProjectFiles } from "../../src/engine/project-files.js"

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-files-"))
})

async function put(path: string, text = "x") {
  await mkdir(join(root, path, ".."), { recursive: true })
  await writeFile(join(root, path), text)
}

describe("collectProjectFiles", () => {
  test("takes source and JSON files, and skips build output, dependencies and hidden folders", async () => {
    await put("index.circuit.tsx", "export default () => null")
    await put("parts/U1/U1.tsx")
    await put("parts/U1/part.yaml")
    await put("tsconfig.json")
    await put("package-lock.json")
    await put("node_modules/a/index.js")
    await put("dist/index/circuit.json")
    await put(".copperflow/history/c0001.json")
    const files = await collectProjectFiles(root)
    expect(Object.keys(files).sort()).toEqual(["index.circuit.tsx", "parts/U1/U1.tsx", "tsconfig.json"])
    expect(files["index.circuit.tsx"]).toBe("export default () => null")
  })

  test("refuses a project that is too large", async () => {
    await put("a.tsx", "x".repeat(100))
    await expect(collectProjectFiles(root, { maxBytes: 50 })).rejects.toThrow(/too large/)
  })
})
