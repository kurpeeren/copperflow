import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { execFileSync } from "node:child_process"
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { runCli } from "../src/cli-commands.js"
import { libraryAdd as addLibrary, libraryUpdate as updateLibraries } from "../src/cli-library.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const KEYS = ["COPPERFLOW_HOME", "COPPERFLOW_MODULES", "COPPERFLOW_BUILTIN_LIBRARY"] as const
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))
let home: string
let shelf: string
let work: string
let project: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "cf-home-"))
  shelf = await mkdtemp(join(tmpdir(), "cf-shelf-"))
  work = await mkdtemp(join(tmpdir(), "cf-libs-"))
  project = await mkdtemp(join(tmpdir(), "cf-proj-"))
  process.env["COPPERFLOW_HOME"] = home
  process.env["COPPERFLOW_MODULES"] = shelf
  process.env["COPPERFLOW_BUILTIN_LIBRARY"] = join(work, "no-built-in")
})

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

const cli = async (args: string[], answer?: string) => {
  const out: string[] = []
  const io = { out: (text: string) => void out.push(text), err: (text: string) => void out.push(text), ...(answer === undefined ? {} : { ask: async () => answer }) }
  const code = await runCli(args, work, io)
  return { code, text: out.join("\n") }
}

async function connect(root: string) {
  const server = createCopperflowServer(root, { engine: inProcessEngine })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  return async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args })
    const content = result.content as Array<{ type: string; text: string }>
    return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
  }
}

/** A real module: made by new_circuit, described, saved by save_module to the shelf. */
async function savedModule(): Promise<string> {
  const maker = await mkdtemp(join(tmpdir(), "cf-maker-"))
  const call = await connect(maker)
  const made = await call("new_circuit", {
    file: "main.circuit.tsx",
    parts: [{ name: "J1", kind: "pinheader", props: { pinCount: 3 } }],
    nets: { IN1: ["J1.pin1"], DI1: ["J1.pin2"], GND: ["J1.pin3"] },
    sheets: {
      Input: {
        does: "24 V digital input: divider, clamp, RC filter",
        parts: [
          { name: "R1", kind: "resistor", value: "10k", footprint: "0603" },
          { name: "R2", kind: "resistor", value: "1.5k", footprint: "0603" },
          { name: "C1", kind: "capacitor", value: "100nF", footprint: "0603" },
        ],
        nets: { IN: ["R1.pin1"], OUT: ["R1.pin2", "R2.pin1", "C1.pin1"], GND: ["R2.pin2", "C1.pin2"] },
        ports: [{ name: "IN", type: "input", carries: "0 to 24 V" }, { name: "OUT", type: "output", carries: "3.3 V logic" }, { name: "GND", type: "ground" }],
      },
    },
    instances: [{ sheet: "Input", name: "CH1", connections: { IN: "IN1", OUT: "DI1", GND: "GND" } }],
    place: false,
  })
  expect(made.isError, made.text).toBe(false)
  const done = await call("save_module", { file: "Input.sheet.tsx" })
  expect(done.isError, done.text).toBe(false)
  return join(shelf, "Input")
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "init.defaultBranch=main", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" })

describe("library names and addresses", () => {
  test("taken names, path separators and dots are refused", async () => {
    const folder = join(work, "lib")
    await mkdir(folder)
    for (const name of ["copperflow", "shelf", "Shelf", "a/b", "a\\b", "..", "../x", "x..", "1x"]) {
      const added = await cli(["library", "add", name, folder])
      expect(added.code, name).toBe(1)
    }
    expect(existsSync(join(home, "libraries.json"))).toBe(false)
  })

  test("an address starting with -, ext:: or file:// is refused before git starts", async () => {
    for (const address of ["-oProxyCommand=calc", "--upload-pack=x", "ext::sh -c touch% /tmp/pwned", "file:///tmp/repo", "https://-x/y", "git@-host:x"]) {
      // A git that is not there would say so; the refusal comes first.
      await expect(addLibrary("lib", address, { now: "2026-11-17", git: { command: "copperflow-no-such-git" } }), address).rejects.toThrow("not a git address")
    }
    expect(existsSync(join(home, "libraries"))).toBe(false)
  })

  test("without git the command says so in one sentence and leaves nothing", async () => {
    await expect(addLibrary("lib", "https://example.com/lib.git", { now: "2026-11-17", git: { command: "copperflow-no-such-git" } })).rejects.toThrow(
      "git is not installed (or not on the PATH); install git to add a library from a git address.",
    )
    expect(await readdir(join(home, "libraries")).catch(() => [])).toEqual([])
    expect(existsSync(join(home, "libraries.json"))).toBe(false)
  })
})

describe("a folder library", () => {
  test("add records the real path; list, update and remove; remove never deletes the folder", async () => {
    const lib = join(work, "lib")
    await mkdir(join(lib, "modules"), { recursive: true })
    await cp(await savedModule(), join(lib, "modules", "Input"), { recursive: true })
    const added = await cli(["library", "add", "mine", "lib"])
    expect(added.code, added.text).toBe(0)
    expect(added.text).toBe(`Added mine: folder ${await import("node:fs/promises").then((fs) => fs.realpath(lib))}; 1 module`)
    const listed = await cli(["library"])
    expect(listed.text).toMatch(/^mine: folder .*lib; 1 module; added 20\d\d-\d\d-\d\d$/)
    expect((await cli(["library", "update", "mine"])).text).toBe("mine is a folder, read where it is; there is nothing to update")
    expect((await cli(["library", "add", "mine", "lib"])).code).toBe(1)
    expect((await cli(["library", "remove", "mine"])).text).toBe("Forgot mine; the folder stays where it is")
    expect(await readdir(join(lib, "modules"))).toEqual(["Input"])
    expect((await cli(["library"])).text).toBe("No libraries. Add one: copperflow library add <name> <git address or folder>")
  })

  test("a shelf folder pushed as it is is a library; the built-in library is named copperflow", async () => {
    const builtIn = join(work, "built-in")
    await mkdir(join(builtIn, "modules"), { recursive: true })
    await cp(await savedModule(), join(builtIn, "modules", "Input"), { recursive: true })
    process.env["COPPERFLOW_BUILTIN_LIBRARY"] = builtIn
    const shelfCopy = join(work, "shelf-copy")
    await cp(shelf, shelfCopy, { recursive: true })
    expect((await cli(["library", "add", "pushed", "shelf-copy"])).text).toContain("; 1 module")
    const listed = (await cli(["library"])).text.split("\n")
    expect(listed[0]).toBe(`copperflow: built in (${builtIn}); 1 module`)
    expect(listed[1]).toMatch(/^pushed: folder /)
  })

  test("a folder that is not there, or a link, is refused", async () => {
    expect((await cli(["library", "add", "gone", "nothing-here"])).code).toBe(1)
    const target = join(work, "target")
    await mkdir(target)
    await symlink(target, join(work, "link"), "junction")
    const linked = await cli(["library", "add", "linked", "link"])
    expect(linked.code).toBe(0)
    expect(linked.text).toContain(target.slice(-6))
  })
})

describe("a git library, through a local bare repository", () => {
  // The test seam: git rewrites the https address to a local bare repository (url.<path>.insteadOf), and the file
  // protocol is allowed for this call only. The address copperflow checks and passes is the https one.
  const ADDRESS = "https://example.test/lib.git"
  let bare: string
  let source: string
  const seam = () => ({
    env: { GIT_ALLOW_PROTOCOL: "https:ssh:file", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.${bare.replaceAll("\\", "/")}.insteadOf`, GIT_CONFIG_VALUE_0: ADDRESS },
  })

  beforeEach(async () => {
    source = join(work, "source")
    bare = join(work, "bare.git")
    await mkdir(join(source, "modules"), { recursive: true })
    await cp(await savedModule(), join(source, "modules", "Input"), { recursive: true })
    // A library's own claim to be verified counts for nothing.
    await writeFile(join(source, "modules", "Input", "verified.json"), JSON.stringify({ by: "Mallory", at: "x", hash: "x" }))
    git(source, "init", "-q")
    git(source, "add", "-A")
    git(source, "commit", "-qm", "first")
    git(work, "clone", "-q", "--bare", source, bare)
  })

  test("add clones shallow, update brings the new commit, and a changed module reads NOT verified again", async () => {
    const added = await addLibrary("team", ADDRESS, { now: "2026-11-17T10:00:00Z", git: seam() })
    expect(added).toMatch(/^Added team: git https:\/\/example\.test\/lib\.git, ref main at [0-9a-f]{7}; 1 module$/)
    expect(await readFile(join(home, "libraries", "team", "modules", "Input", "Input.sheet.tsx"), "utf8")).toContain("export default function Input()")
    const call = await connect(project)
    expect((await call("list_modules")).text).toMatch(/^Input: .*; NOT verified\nteam\/Input: .*; NOT verified; from team \(git\)$/)
    expect((await cli(["modules", "verify", "team/Input", "--by", "Ada"], "team/Input")).code).toBe(0)
    expect((await call("list_modules")).text).toMatch(/team\/Input: .*; verified by Ada; from team \(git\)$/)

    expect(await updateLibraries("team", { now: "2026-11-18T10:00:00Z", git: seam() })).toMatch(/^team: already at [0-9a-f]{7}$/)
    const sheet = join(source, "modules", "Input", "Input.sheet.tsx")
    await writeFile(sheet, (await readFile(sheet, "utf8")).replace("10k", "12k"))
    git(source, "commit", "-qam", "second")
    git(source, "push", "-q", bare, "HEAD:main")
    expect(await updateLibraries("team", { now: "2026-11-18T10:00:00Z", git: seam() })).toMatch(/^team: updated from [0-9a-f]{7} to [0-9a-f]{7}$/)
    expect(await readFile(join(home, "libraries", "team", "modules", "Input", "Input.sheet.tsx"), "utf8")).toContain("12k")
    expect((await call("list_modules")).text).toMatch(/team\/Input: .*; NOT verified; from team \(git\)$/)
    expect((await cli(["library"])).text).toMatch(/^team: git https:\/\/example\.test\/lib\.git, ref main at [0-9a-f]{7}; 1 module; added 2026-11-17, updated 2026-11-18$/)

    expect((await cli(["library", "remove", "team"])).text).toBe("Forgot team and deleted its clone")
    expect(existsSync(join(home, "libraries", "team"))).toBe(false)
  })

  test("a failed clone leaves nothing behind", async () => {
    await rm(bare, { recursive: true, force: true })
    await expect(addLibrary("team", ADDRESS, { now: "2026-11-17", git: seam() })).rejects.toThrow("git clone failed")
    expect(await readdir(join(home, "libraries")).catch(() => [])).toEqual([])
    expect(existsSync(join(home, "libraries.json"))).toBe(false)
  })

  test("a ref that git could read as an option is refused", async () => {
    await expect(addLibrary("team", ADDRESS, { now: "2026-11-17", ref: "--upload-pack=x", git: seam() })).rejects.toThrow("not a branch or tag name")
  })
})
