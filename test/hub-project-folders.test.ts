import { describe, expect, test, vi } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { createWriteStream } from "node:fs"
import { chmod, mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises"
import { Readable } from "node:stream"
import { checkZipFile, StreamZipWriter } from "../src/hub/zip-stream.js"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { cleanFolder, runWorkspaceClean } from "../src/hosted/workspace-clean.js"
import { removeProjectFolders, removeUserFolders, retryTrash, sweepOrphans, trashFailures, trashInFlight } from "../src/hub/project-folders.js"
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
  test("no file in src/hub but the removal module removes, renames or unlinks without saying it is not the projects tree", () => {
    // Every rm, rmdir, unlink, rename and the project's own remove helpers, in every file but project-folders.ts, must
    // say on its line which tree it touches: never out of the projects tree except the trash move project-folders.ts
    // makes (and that move is called from nowhere else).
    const allowedReasons = ["uploads only", "trash only", "into the projects tree, never out of it", "out of the projects tree, called only from project-folders.ts", "primitive; its callers are checked"]
    const offenders: string[] = []
    for (const path of sources(HUB)) {
      const name = path.slice(HUB.length).replace(/\\/g, "/")
      if (name === "project-folders.ts") continue
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, index) => {
          // Comments are skipped; a line that declares a function is checked like any other.
          if (/^\s*(\/\/|\*)/.test(line)) return
          const call = /\b(rm|rmdir|unlink|rename|rmSync|rmdirSync|unlinkSync|renameSync|removeTree|removeWhatWeCan)\(|files\.(moveToTrash|removeParked|openParked|discard)\(/.test(line)
          if (!call) return
          const reason = /\/\/ removal: (.+)$/.exec(line)?.[1]?.trim()
          if (!reason || !allowedReasons.includes(reason)) offenders.push(`${name}:${index + 1}`)
        })
      if (/files\.moveToTrash\(/.test(readFileSync(path, "utf8"))) offenders.push(`${name}: calls moveToTrash`)
    }
    expect(offenders).toEqual([])
  })

  test("trash counts in the user's usage; a failed removal keeps it charged, is audited, and is retried with a growing delay", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-folders-"))
    const files = new ProjectFiles(data)
    await files.create(USER, P1)
    await writeFile(join(files.projectDir(USER, P1), "big.bin"), Buffer.alloc(5000))
    const audits: string[] = []
    let removable = false
    const realRemove = files.removeParked.bind(files)
    files.removeParked = async (parked) => (removable ? realRemove(parked) : false)
    const managed = new ManagedRunner({ log: () => undefined, launch: async () => Promise.reject(new Error("no launches")), clean: async () => Promise.reject(new Error("engine busy")) })
    const hub = { runner: managed, files, store: { audit: (entry: { event: string }) => audits.push(entry.event) } as never, log: () => undefined }
    let clock = Date.now()
    const now = () => clock
    await removeProjectFolders(hub, USER, [P1])
    expect(await readdir(files.userDir(USER))).toEqual([])
    expect(await files.measureUser(USER)).toEqual({ bytes: 5000 })
    expect(audits).toEqual(["trash-removal-failed"])
    // Not retried before its delay; each failure doubles it (5 s, 10 s, 20 s ...).
    clock += 1_000
    expect(await retryTrash(hub, now)).toBe(1)
    expect(audits).toHaveLength(1)
    clock += 10_000
    expect(await retryTrash(hub, now)).toBe(1)
    expect(audits).toHaveLength(2)
    const [failure] = trashFailures()
    expect(failure?.failures).toBe(2)
    expect(failure?.nextAt).toBe(clock + 10_000)
    // A fixed category, never the engine's own text.
    expect(failure?.reason).toBe("engine-error")
    clock += 10_000
    removable = true
    expect(await retryTrash(hub, now)).toBe(0)
    expect(trashFailures()).toEqual([])
    expect(await files.measureUser(USER)).toEqual({ bytes: 0 })
    expect(await readdir(files.trash)).toEqual([])
  })

  test("one removal per trash folder: the sweep never starts on a folder the delete route is still emptying", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-folders-"))
    const files = new ProjectFiles(data)
    await files.create(USER, P1)
    let release!: () => void
    const gate = new Promise<void>((done) => (release = done))
    let cleaners = 0
    let shares = 0
    const realOpen = files.openParked.bind(files)
    files.openParked = async (parked) => {
      shares += 1
      return realOpen(parked)
    }
    const managed = new ManagedRunner({
      log: () => undefined,
      launch: async () => Promise.reject(new Error("no launches")),
      clean: async () => {
        cleaners += 1
        await gate
      },
    })
    const hub = { runner: managed, files }
    const removing = removeProjectFolders(hub, USER, [P1])
    await vi.waitFor(() => expect(cleaners).toBe(1))
    const [parked] = await files.allTrash()
    expect(trashInFlight(parked?.path as string)).toBe(true)
    // The sweep runs meanwhile: it leaves the folder alone.
    expect(await retryTrash(hub)).toBe(1)
    expect(cleaners).toBe(1)
    expect(shares).toBe(1)
    release()
    await removing
    expect(await readdir(files.trash)).toEqual([])
    expect(trashFailures()).toEqual([])
  })

  test("removal uses both hands: the cleaner removes what the workspace owns, then the hub removes what it owns", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-folders-"))
    const files = new ProjectFiles(data)
    const dir = await files.create(USER, P1)
    await mkdir(join(dir, "made-by-workspace"))
    await writeFile(join(dir, "made-by-workspace", "f"), "x")
    await mkdir(join(dir, "made-by-hub"))
    await writeFile(join(dir, "made-by-hub", "g"), "y")
    const order: string[] = []
    const realOpen = files.openParked.bind(files)
    files.openParked = async (parked) => {
      order.push("hub shares its entries")
      return realOpen(parked)
    }
    const realRemove = files.removeParked.bind(files)
    files.removeParked = async (parked) => {
      order.push(`hub removes the rest (${(await readdir(parked)).join(",")})`)
      return realRemove(parked)
    }
    const managed = new ManagedRunner({
      log: () => undefined,
      launch: async () => Promise.reject(new Error("no launches")),
      clean: async (parked) => {
        order.push("cleaner removes the workspace's")
        await rm(join(parked, "made-by-workspace"), { recursive: true })
      },
    })
    await removeProjectFolders({ runner: managed, files }, USER, [P1])
    expect(order).toEqual(["hub shares its entries", "cleaner removes the workspace's", "hub removes the rest (made-by-hub)"])
    expect(await readdir(files.trash)).toEqual([])
  })

  test.skipIf(process.platform === "win32" || !process.getgid)("an uploaded project's nested folders and files get the workspace group, 2770 and 0660, before they are placed", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-folders-"))
    const files = new ProjectFiles(data)
    files.workspaceGroup = process.getgid?.() as number
    const zipPath = join(data, "upload.zip")
    const out = createWriteStream(zipPath)
    const zip = new StreamZipWriter(out)
    await zip.addFile("src/deep/a.circuit.tsx", Readable.from([Buffer.from("export default () => null\n")]), new Date())
    await zip.finish()
    await new Promise<void>((done) => out.end(() => done()))
    const staged = await files.unpackStaged(await checkZipFile(zipPath, 1_000_000))
    await files.place(staged, USER, P1)
    const dir = files.projectDir(USER, P1)
    for (const folder of [dir, join(dir, "src"), join(dir, "src", "deep")]) {
      const info = await stat(folder)
      expect(info.mode & 0o7777).toBe(0o2770)
      expect(info.gid).toBe(files.workspaceGroup)
    }
    const file = await stat(join(dir, "src", "deep", "a.circuit.tsx"))
    expect(file.mode & 0o777).toBe(0o660)
    expect(file.gid).toBe(files.workspaceGroup)
  })

  test("crash leftovers: stale staging folders and project folders without a row are removed and audited", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-folders-"))
    const files = new ProjectFiles(data)
    await files.create(USER, P1)
    await files.create(USER, P2)
    await mkdir(join(files.uploads, `stage-${"e".repeat(32)}`), { recursive: true })
    const audits: string[] = []
    const store = { projectIds: () => [P2], audit: (entry: { event: string }) => audits.push(entry.event) } as never
    const managed = new ManagedRunner({ log: () => undefined, launch: async () => Promise.reject(new Error("no launches")) })
    // Young leftovers stay: an upload may be between its rename and its row.
    await sweepOrphans({ runner: managed, files, store })
    expect(await readdir(files.userDir(USER))).toEqual([P1, P2].sort())
    const later = () => Date.now() + 2 * 60 * 60_000
    await sweepOrphans({ runner: managed, files, store }, later)
    expect(await readdir(files.userDir(USER))).toEqual([P2])
    expect(await readdir(files.uploads)).toEqual([])
    expect(audits.sort()).toEqual(["orphan-folder-removed", "stale-upload-removed"])
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
      "--ulimit", "nofile=1024:1024",
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
