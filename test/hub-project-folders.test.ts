import { describe, expect, test } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { removeProjectFolders, removeUserFolders } from "../src/hub/project-folders.js"
import { ProjectFiles } from "../src/hub/projects.js"
import { ManagedRunner, StopUnconfirmedError, type Launched } from "../src/hub/runner/runner.js"

const HUB = fileURLToPath(new URL("../src/hub/", import.meta.url))
const USER = "a".repeat(32)
const P1 = "b".repeat(32)
const P2 = "c".repeat(32)

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : []
  })
}

function runner(options: { confirm?: boolean } = {}) {
  const launched: string[] = []
  let releaseCheck!: () => void
  const checkGate = new Promise<void>((done) => (releaseCheck = done))
  const managed = new ManagedRunner({
    log: () => undefined,
    confirmGone: async () => options.confirm ?? true,
    launch: async (spec): Promise<Launched> => {
      launched.push(spec.id)
      return { address: { studio: "http://127.0.0.1:1", mcp: "http://127.0.0.1:2" }, exited: new Promise(() => undefined), stop: async () => undefined }
    },
  })
  managed.setStartCheck(() => checkGate)
  return { managed, launched, releaseCheck }
}

describe("one function removes project folders", () => {
  test("nothing else in src/hub removes anything from the projects tree", () => {
    const allowed = new Set(["project-folders.ts", "projects.ts", "safe-files.ts"])
    const offenders = sources(HUB)
      .filter((path) => !allowed.has(path.slice(HUB.length).replace(/\\/g, "/")))
      .filter((path) => /files\.remove(User)?\(|removeTree\(|removeViaTrash\(/.test(readFileSync(path, "utf8")))
    expect(offenders).toEqual([])
  })

  test("a user deletion with a start in flight never launches, and the folders go", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-folders-"))
    const files = new ProjectFiles(data)
    await files.create(USER, P1)
    await files.create(USER, P2)
    await writeFile(join(files.projectDir(USER, P1), "a.txt"), "x")
    const stub = runner()
    const opening = stub.managed.ensure({ id: P1, userId: USER, projectDir: files.projectDir(USER, P1), basePath: "", publicOrigin: `https://${P1}.ws.localhost` })
    opening.catch(() => undefined)
    const removing = removeUserFolders({ runner: stub.managed, files }, USER, [P1, P2])
    await new Promise((done) => setImmediate(done))
    stub.releaseCheck()
    await removing
    await expect(opening).rejects.toThrow(/being downloaded or deleted/)
    expect(stub.launched).toEqual([])
    expect(await readdir(files.root)).toEqual([])
  })

  test("a block that cannot be confirmed removes nothing", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-folders-"))
    const files = new ProjectFiles(data)
    await files.create(USER, P1)
    const stub = runner({ confirm: false })
    await expect(removeProjectFolders({ runner: stub.managed, files }, USER, [P1])).rejects.toBeInstanceOf(StopUnconfirmedError)
    expect(await readdir(files.userDir(USER))).toEqual([P1])
  })
})
