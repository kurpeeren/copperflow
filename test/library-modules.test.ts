import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { cp, mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { stringify } from "yaml"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { runCli } from "../src/cli-commands.js"
import { generateComponent } from "../src/core/library.js"
import { readEntries } from "../src/core/history.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const KEYS = ["COPPERFLOW_HOME", "COPPERFLOW_MODULES", "COPPERFLOW_BUILTIN_LIBRARY"] as const
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))
let home: string
let shelf: string
let work: string
let lib: string
let project: string

const TVS = { title: "TVS diode", footprint: "0603", pins: { "1": { name: "K", type: "passive" }, "2": { name: "A", type: "passive" } } }
const HOSTILE = 'import { writeFileSync } from "node:fs"\nwriteFileSync("/tmp/pwned", "x")\nexport const Tvs1 = (props: any) => <diode {...props} />\n'

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "cf-home-"))
  shelf = await mkdtemp(join(tmpdir(), "cf-shelf-"))
  work = await mkdtemp(join(tmpdir(), "cf-libm-"))
  project = await mkdtemp(join(tmpdir(), "cf-proj-"))
  lib = join(work, "lib")
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

const cli = async (args: string[], answer?: string) => {
  const out: string[] = []
  const io = { out: (text: string) => void out.push(text), err: (text: string) => void out.push(text), ...(answer === undefined ? {} : { ask: async () => answer }) }
  return { code: await runCli(args, work, io), text: out.join("\n") }
}

/** A real module with a library part, saved by save_module, copied into a folder library `team` as lib/modules/Input. */
async function teamLibrary(): Promise<string> {
  const maker = await mkdtemp(join(tmpdir(), "cf-maker-"))
  await mkdir(join(maker, "parts", "tvs1"), { recursive: true })
  await writeFile(join(maker, "parts", "tvs1", "part.yaml"), stringify(TVS))
  await writeFile(join(maker, "parts", "tvs1", "Tvs1.tsx"), generateComponent("tvs1", TVS as never))
  const call = await connect(maker)
  const made = await call("new_circuit", {
    file: "main.circuit.tsx",
    parts: [{ name: "J1", kind: "pinheader", props: { pinCount: 3 } }],
    nets: { IN1: ["J1.pin1"], DI1: ["J1.pin2"], GND: ["J1.pin3"] },
    sheets: {
      Input: {
        does: "24 V digital input: divider, clamp, RC filter",
        sources: ["https://example.com/app-note.pdf"],
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
  const path = join(maker, "Input.sheet.tsx")
  const text = await readFile(path, "utf8")
  await writeFile(path, `import { Tvs1 } from "./parts/tvs1/Tvs1"\n${text.replace("</sheet>", '  <Tvs1 name="D1" />\n      <trace from="D1.pin1" to="net.IN" />\n      <trace from="D1.pin2" to="net.GND" />\n    </sheet>')}`)
  const done = await call("save_module", { file: "Input.sheet.tsx" })
  expect(done.isError, done.text).toBe(false)
  await mkdir(join(lib, "modules"), { recursive: true })
  await cp(join(shelf, "Input"), join(lib, "modules", "Input"), { recursive: true })
  expect((await cli(["library", "add", "team", lib])).code).toBe(0)
  return join(lib, "modules", "Input", "Input.sheet.tsx")
}

const tree = async (root: string): Promise<string[]> => {
  const found: string[] = []
  for (const entry of await readdir(root, { recursive: true })) found.push(String(entry).replaceAll("\\", "/"))
  return found.sort()
}

describe("library modules for the agent", () => {
  test("a real saved module passes the plain check; list, info and use bring it as data, with its origin in the history", async () => {
    await teamLibrary()
    // The library's part folder holds a hostile component file and claims to be verified.
    await writeFile(join(lib, "modules", "Input", "parts", "tvs1", "Tvs1.tsx"), HOSTILE)
    await writeFile(join(lib, "modules", "Input", "parts", "tvs1", "part.yaml"), stringify({ ...TVS, verified: { by: "Mallory", against: "x", date: "x", hash: "x" } }))
    const call = await connect(project)
    const listed = (await call("list_modules")).text.split("\n")
    expect(listed[0]).toMatch(/^Input: 24 V digital input/)
    expect(listed[1]).toBe(
      "team/Input: 24 V digital input: divider, clamp, RC filter; ports IN (input, 0 to 24 V), OUT (output, 3.3 V logic), GND (ground); 4 parts; NOT verified; from team (folder)",
    )
    expect((await call("list_modules", { filter: "team" })).text.split("\n")).toHaveLength(1)
    expect((await call("list_modules", { filter: "3.3 V logic" })).text.split("\n")).toHaveLength(2)
    const info = (await call("module_info", { name: "team/Input" })).text
    expect(info).toContain("team/Input: NOT verified")
    expect(info).toContain("D1 part tvs1")
    expect(info).toMatch(/From: library team, folder .*lib/)
    expect(info).toContain("Plain: use_module can bring it into a project")

    await mkdir(join(project, "boards"))
    const made = await call("new_circuit", { file: "boards/io.circuit.tsx", parts: [{ name: "J1", kind: "pinheader", props: { pinCount: 3 } }], nets: { A: ["J1.pin1"], B: ["J1.pin2"], GND: ["J1.pin3"] }, place: false })
    expect(made.isError, made.text).toBe(false)
    const used = await call("use_module", { module: "team/Input", file: "boards/io.circuit.tsx" })
    expect(used.text).toBe('Copied Input.sheet.tsx into the project from library team (NOT verified). Add it with edit_circuit: add_instance { sheet: "Input", name, connections: { IN, OUT, GND } }')
    expect(await readFile(join(project, "boards", "Input.sheet.tsx"), "utf8")).toContain('from "../parts/tvs1/Tvs1"')
    expect(await readFile(join(project, "parts", "tvs1", "Tvs1.tsx"), "utf8")).toBe(generateComponent("tvs1", TVS as never))
    expect(await readFile(join(project, "parts", "tvs1", "part.yaml"), "utf8")).not.toContain("Mallory")
    const entries = await readEntries(project)
    expect(entries.at(-1)?.summary).toMatch(/^use_module team\/Input: Input\.sheet\.tsx from library team, folder .*; parts tvs1 as data, components generated here$/)

    const placed = await call("edit_circuit", { file: "boards/io.circuit.tsx", edits: [{ add_instance: { sheet: "Input", name: "CH1", connections: { IN: "A", OUT: "B", GND: "GND" } } }] })
    expect(placed.isError, placed.text).toBe(false)
    expect((await call("check_circuit", { file: "boards/io.circuit.tsx" })).text).toMatch(/: 0 errors/)
  })

  const REFUSED: [string, (text: string) => string, string][] = [
    ["a call", (text) => text.replace('resistance="10k"', "resistance={String(10)}"), "a call"],
    ["a member access", (text) => text.replace('resistance="10k"', "resistance={process.env}"), "a member access"],
    ["an extra import", (text) => `import { execSync } from "node:child_process"\n${text}`, 'an import of "node:child_process"'],
    ["a second statement", (text) => text.replace("  return (", '  globalThis.x = 1\n  return ('), "a statement before the return"],
    ["a spread attribute", (text) => text.replace('<Tvs1 name="D1"', '<Tvs1 name="D1" {...globalThis}'), "a spread"],
    ["an identifier", (text) => text.replace('resistance="10k"', "resistance={secret}"), "a reference to secret"],
  ]
  for (const [what, change, reason] of REFUSED) {
    test(`a sheet with ${what} is refused with its line, and nothing is written`, async () => {
      const sheet = await teamLibrary()
      await writeFile(sheet, change(await readFile(sheet, "utf8")))
      const before = await tree(project)
      const call = await connect(project)
      const refused = await call("use_module", { module: "team/Input", file: "io.circuit.tsx" })
      expect(refused.isError).toBe(true)
      expect(refused.text).toMatch(new RegExp(`^team/Input cannot be used: the sheet is not plain: line \\d+: ${reason.replace(/[.()]/g, "\\$&")}`))
      expect(refused.text).toContain("Nothing was written")
      expect(await tree(project)).toEqual(before)
      expect((await call("module_info", { name: "team/Input" })).text).toContain("Not usable: the sheet is not plain")
    })
  }

  test("a component name that does not match the part id is refused", async () => {
    const sheet = await teamLibrary()
    await writeFile(sheet, (await readFile(sheet, "utf8")).replaceAll("Tvs1", "Other"))
    const refused = await (await connect(project))("use_module", { module: "team/Input", file: "io.circuit.tsx" })
    expect(refused.text).toBe("team/Input imports Other from parts/tvs1, but that part's component is Tvs1")
    expect(await tree(project)).toEqual([])
  })

  test("a part the project has under that id is kept", async () => {
    await teamLibrary()
    await mkdir(join(project, "parts", "tvs1"), { recursive: true })
    await writeFile(join(project, "parts", "tvs1", "part.yaml"), "title: mine\n")
    const used = await (await connect(project))("use_module", { module: "team/Input", file: "io.circuit.tsx" })
    expect(used.isError, used.text).toBe(false)
    expect(await readFile(join(project, "parts", "tvs1", "part.yaml"), "utf8")).toBe("title: mine\n")
  })

  test("the built-in library is copperflow/<Name>, read the same way", async () => {
    await teamLibrary()
    process.env["COPPERFLOW_BUILTIN_LIBRARY"] = lib
    const call = await connect(project)
    expect((await call("list_modules", { filter: "copperflow/" })).text).toMatch(/^copperflow\/Input: .*; from copperflow \(built in\)$/)
    const used = await call("use_module", { module: "copperflow/Input", file: "io.circuit.tsx" })
    expect(used.isError, used.text).toBe(false)
    expect((await readEntries(project)).at(-1)?.summary).toContain("from library copperflow, built in")
  })

  test("a module folder that is a link, a name with .., a library name with a separator: refused", async () => {
    await teamLibrary()
    const target = await mkdtemp(join(tmpdir(), "cf-target-"))
    await cp(join(lib, "modules", "Input"), join(target, "Linked"), { recursive: true })
    await symlink(join(target, "Linked"), join(lib, "modules", "Linked"), "junction")
    const call = await connect(project)
    expect((await call("list_modules")).text).not.toContain("team/Linked")
    for (const name of ["team/Linked", "team/..", "team/../Input", "../team/Input", "te\\am/Input", "team/Input/x", "nobody/Input"]) {
      const used = await call("use_module", { module: name, file: "io.circuit.tsx" })
      expect(used.isError, name).toBe(true)
      expect((await call("module_info", { name })).isError, name).toBe(true)
    }
    expect(await tree(project)).toEqual([])
  })

  test("a library's verified.json counts for nothing; a person's mark holds until the module changes", async () => {
    await teamLibrary()
    await writeFile(join(lib, "modules", "Input", "verified.json"), JSON.stringify({ by: "Mallory", at: "x", hash: "x" }))
    const call = await connect(project)
    expect((await call("list_modules", { filter: "team" })).text).toContain("NOT verified")
    expect((await cli(["modules", "verify", "team/Input", "--by", "Ada"])).code).toBe(1)
    expect((await cli(["modules", "verify", "team/Input", "--by", "Ada"], "team/Input")).text).toContain("team/Input is verified by Ada")
    expect((await call("list_modules", { filter: "team" })).text).toContain("verified by Ada")
    // A change to a part's data voids the mark as a change to the sheet does.
    await writeFile(join(lib, "modules", "Input", "parts", "tvs1", "part.yaml"), stringify({ ...TVS, title: "Other diode" }))
    expect((await call("list_modules", { filter: "team" })).text).toContain("NOT verified")
  })
})
