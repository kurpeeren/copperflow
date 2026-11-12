import { describe, expect, test } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readdir, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { cleanFolder, runWorkspaceClean } from "../src/hosted/workspace-clean.js"
import { removeProjectFolders, removeUserFolders, retryTrash } from "../src/hub/project-folders.js"
import { cleanerRunArgs } from "../src/hub/runner/container-runner.js"
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
      .filter((path) => /files\.(moveToTrash|removeParked)\(|removeTree\(|\brm\([^)]*projects/.test(readFileSync(path, "utf8")))
    expect(offenders).toEqual([])
  })

  test("trash counts in the user's usage; a failed cleaning keeps it charged, is audited, and the sweep retries it", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-folders-"))
    const files = new ProjectFiles(data)
    await files.create(USER, P1)
    await writeFile(join(files.projectDir(USER, P1), "big.bin"), Buffer.alloc(5000))
    const audits: string[] = []
    let cleanerWorks = false
    const managed = new ManagedRunner({
      log: () => undefined,
      launch: async () => Promise.reject(new Error("no launches")),
      clean: async () => {
        if (!cleanerWorks) throw new Error("engine busy")
      },
    })
    const hub = { runner: managed, files, store: { audit: (entry: { event: string }) => audits.push(entry.event) } as never, log: () => undefined }
    await removeProjectFolders(hub, USER, [P1])
    expect(await readdir(files.userDir(USER))).toEqual([])
    expect(await files.measureUser(USER)).toEqual({ bytes: 5000 })
    expect(audits).toEqual(["trash-removal-failed"])
    expect(await retryTrash(hub)).toBe(1)
    cleanerWorks = true
    expect(await retryTrash(hub)).toBe(0)
    expect(await files.measureUser(USER)).toEqual({ bytes: 0 })
    expect(await readdir(files.trash)).toEqual([])
  })

  test("the cleaning container runs as the workspace user with only the trash folder, no network, and the fixed command", () => {
    const trash = "/srv/copperflow/trash/" + `${USER}-${"d".repeat(32)}`
    expect(cleanerRunArgs(trash, { image: "copperflow-workspace", group: "2000", identity: undefined }, "cf-clean-0123456789abcdef")).toEqual([
      "run",
      "--rm",
      "--name", "cf-clean-0123456789abcdef",
      "--label", "org.copperflow.workspace=1",
      "--user", "10001:2000",
      "--log-driver", "none",
      "--read-only",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--network", "none",
      "--pids-limit", "32",
      "--memory", "128m",
      "--memory-swap", "128m",
      "--cpus", "0.5",
      "--mount", `type=bind,source=${trash},target=/work`,
      "--workdir", "/work",
      "--entrypoint", "node",
      "copperflow-workspace",
      "--max-old-space-size=96",
      "/app/dist/cli.js",
      "workspace-clean",
      "/work",
    ])
    expect(() => cleanerRunArgs("/srv/a,source=/", { image: "img", group: "2000", identity: undefined }, "cf-clean-0123456789abcdef")).toThrow(/refused/)
    expect(() => cleanerRunArgs(trash, { image: "img", group: "2000", identity: undefined }, "cf-ws-x")).toThrow(/refused/)
  })

  test("workspace-clean empties only /work, making owner-only entries removable without following links", async () => {
    await expect(runWorkspaceClean(["/etc"])).rejects.toThrow(/Usage/)
    const root = await mkdtemp(join(tmpdir(), "cf-clean-"))
    const outside = await mkdtemp(join(tmpdir(), "cf-clean-out-"))
    await writeFile(join(outside, "keep.txt"), "x")
    await mkdir(join(root, "locked", "deep"), { recursive: true })
    await writeFile(join(root, "locked", "deep", "f.txt"), "x")
    await symlink(outside, join(root, "link"), "junction")
    if (process.platform !== "win32") {
      await chmod(join(root, "locked", "deep"), 0o500)
      await chmod(join(root, "locked"), 0o000)
    }
    await cleanFolder(root)
    expect(await readdir(root)).toEqual([])
    expect(await readdir(outside)).toEqual(["keep.txt"])
  })

  test.skipIf(process.platform === "win32")("an owner-only folder the hub cannot read fails the measurement (over quota)", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-folders-"))
    const files = new ProjectFiles(data)
    const dir = await files.create(USER, P1)
    await mkdir(join(dir, "hidden"))
    await chmod(join(dir, "hidden"), 0o000)
    try {
      const measured = await files.measureUser(USER)
      if (process.getuid?.() !== 0) expect(measured).toEqual({ failed: "a folder could not be read (EACCES)" })
    } finally {
      await chmod(join(dir, "hidden"), 0o700)
    }
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
