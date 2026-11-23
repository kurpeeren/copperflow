import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { lstat, mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { runCli } from "../src/cli-commands.js"
import { shelfDir } from "../src/core/modules.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

let shelf: string
let first: string
let second: string
// The shelf alone: a home folder of its own (no libraries the person added) and no built-in library.
const KEPT = ["COPPERFLOW_MODULES", "COPPERFLOW_HOME", "COPPERFLOW_BUILTIN_LIBRARY"] as const
const before = KEPT.map((name) => process.env[name])

beforeEach(async () => {
  shelf = await mkdtemp(join(tmpdir(), "cf-shelf-"))
  const home = await mkdtemp(join(tmpdir(), "cf-home-"))
  process.env["COPPERFLOW_MODULES"] = shelf
  process.env["COPPERFLOW_HOME"] = home
  process.env["COPPERFLOW_BUILTIN_LIBRARY"] = join(home, "no-library")
  first = await mkdtemp(join(tmpdir(), "cf-mod-a-"))
  second = await mkdtemp(join(tmpdir(), "cf-mod-b-"))
})

afterEach(() => {
  KEPT.forEach((name, i) => {
    if (before[i] === undefined) delete process.env[name]
    else process.env[name] = before[i]
  })
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

const INPUT = {
  does: "24 V digital input: divider, clamp, RC filter",
  sources: ["https://example.com/app-note.pdf"],
  parts: [
    { name: "R1", kind: "resistor", value: "10k", footprint: "0603" },
    { name: "R2", kind: "resistor", value: "1.5k", footprint: "0603" },
    { name: "C1", kind: "capacitor", value: "100nF", footprint: "0603" },
    { name: "R3", kind: "resistor", value: "1k", footprint: "0603" },
  ],
  nets: { IN: ["R1.pin1"], DIV: ["R1.pin2", "R2.pin1", "R3.pin1"], OUT: ["R3.pin2", "C1.pin1"], GND: ["R2.pin2", "C1.pin2"] },
  ports: [
    { name: "IN", type: "input", carries: "0 to 24 V from the field" },
    { name: "OUT", type: "output", carries: "3.3 V logic" },
    { name: "GND", type: "ground" },
  ],
}

async function board(call: Awaited<ReturnType<typeof connect>>, sheet: Record<string, unknown> = INPUT) {
  const made = await call("new_circuit", {
    file: "main.circuit.tsx",
    parts: [{ name: "J1", kind: "pinheader", props: { pinCount: 3 } }],
    nets: { IN1: ["J1.pin1"], DI1: ["J1.pin2"], GND: ["J1.pin3"] },
    sheets: { Input: sheet },
    instances: [{ sheet: "Input", name: "CH1", connections: { IN: "IN1", OUT: "DI1", GND: "GND" } }],
    place: false,
  })
  expect(made.isError, made.text).toBe(false)
}

test("the shelf is COPPERFLOW_MODULES, else .copperflow/modules in the home folder", () => {
  expect(shelfDir({ COPPERFLOW_MODULES: "/x/y" })).toBe("/x/y")
  expect(shelfDir({}).replaceAll("\\", "/")).toMatch(/\/\.copperflow\/modules$/)
})

describe("save_module", () => {
  test("refuses a sheet without does or with a port that says nothing, pointing to describe_sheet", async () => {
    const call = await connect(first)
    await board(call, { ...INPUT, does: undefined, ports: ["IN", { name: "OUT", type: "output" }, "GND"] })
    const refused = await call("save_module", { file: "Input.sheet.tsx" })
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain("Input.sheet.tsx is missing does, port IN, port GND")
    expect(refused.text).toContain("describe_sheet")
    expect(await readdir(shelf)).toEqual([])
  })

  test("copies the sheet to the shelf and refuses a taken name unless replace", async () => {
    const call = await connect(first)
    await board(call)
    const saved = await call("save_module", { file: "Input.sheet.tsx" })
    expect(saved.isError, saved.text).toBe(false)
    expect(saved.text).toContain("Saved Input to the shelf")
    expect(await readFile(join(shelf, "Input", "Input.sheet.tsx"), "utf8")).toBe(await readFile(join(first, "Input.sheet.tsx"), "utf8"))
    const again = await call("save_module", { file: "Input.sheet.tsx" })
    expect(again).toMatchObject({ isError: true })
    expect(again.text).toContain("replace")
    expect((await call("save_module", { file: "Input.sheet.tsx", replace: true })).isError).toBe(false)
  })

  test("refuses a sheet that does not build", async () => {
    const call = await connect(first)
    await board(call)
    const path = join(first, "Input.sheet.tsx")
    await writeFile(path, (await readFile(path, "utf8")).replace("<sheet ", "<sheet width={-1} "))
    const refused = await call("save_module", { file: "Input.sheet.tsx" })
    expect(refused).toMatchObject({ isError: true })
    expect(refused.text).toContain("does not build")
  })

  test("takes the library parts the sheet uses along, under parts/", async () => {
    const call = await connect(first)
    await mkdir(join(first, "parts", "TVS1"), { recursive: true })
    await writeFile(join(first, "parts", "TVS1", "part.yaml"), "title: TVS\n")
    await writeFile(join(first, "parts", "TVS1", "Tvs1.tsx"), "export const Tvs1 = (props: { name: string }) => <diode {...props} />\n")
    await board(call)
    const path = join(first, "Input.sheet.tsx")
    const text = await readFile(path, "utf8")
    await writeFile(path, `import { Tvs1 } from "./parts/TVS1/Tvs1"\n${text.replace("</sheet>", '  <Tvs1 name="D1" />\n      <trace from="D1.pin1" to="net.IN" />\n      <trace from="D1.pin2" to="net.GND" />\n    </sheet>')}`)
    const saved = await call("save_module", { file: "Input.sheet.tsx" })
    expect(saved.isError, saved.text).toBe(false)
    expect(await readFile(join(shelf, "Input", "parts", "TVS1", "part.yaml"), "utf8")).toBe("title: TVS\n")
    const info = await call("list_modules", { name: "Input" })
    expect(info.text).toContain("D1 part TVS1")
  })
})

describe("the shelf from an agent", () => {
  test("list_modules writes one line a module; with name the card, parts, sources and origin, not the code", async () => {
    const call = await connect(first)
    await board(call)
    await call("save_module", { file: "Input.sheet.tsx" })
    const listed = await call("list_modules")
    expect(listed.text).toBe(
      "Input: 24 V digital input: divider, clamp, RC filter; ports IN (input, 0 to 24 V from the field), OUT (output, 3.3 V logic), GND (ground); 4 parts; NOT verified",
    )
    expect((await call("list_modules", { filter: "nothing like it" })).text).toBe("No modules match nothing like it.")
    expect((await call("list_modules", { filter: "clamp" })).text).toContain("Input:")
    expect((await call("list_modules", { filter: "OUT" })).text).toContain("Input:")
    const info = await call("list_modules", { name: "Input" })
    expect(info.text).toContain("Does: 24 V digital input: divider, clamp, RC filter")
    expect(info.text).toContain("  port IN (input, 0 to 24 V from the field)")
    expect(info.text).toContain("R2 resistor 1.5k 0603")
    expect(info.text).toContain("Sources: https://example.com/app-note.pdf")
    expect(info.text).toMatch(/Saved from .*Input\.sheet\.tsx on \d{4}-\d\d-\d\d/)
    expect(info.text).toContain("NOT verified")
    expect(info.text).not.toContain("<trace")
  })

  test("a long list stops at 60 lines and says how many more", async () => {
    await mkdir(shelf, { recursive: true })
    const call = await connect(first)
    await board(call)
    for (let n = 0; n < 63; n++) await call("save_module", { file: "Input.sheet.tsx", name: `M${String(n).padStart(2, "0")}` })
    const lines = (await call("list_modules")).text.split("\n")
    expect(lines).toHaveLength(61)
    expect(lines[60]).toBe("… and 3 more (narrow with filter)")
  })

  test("a line is at most 200 characters", async () => {
    const call = await connect(first)
    const long = { ...INPUT, does: "d".repeat(160), ports: INPUT.ports.map((port) => ({ ...port, carries: "c".repeat(80) })) }
    await board(call, long)
    await call("save_module", { file: "Input.sheet.tsx" })
    const line = (await call("list_modules")).text
    expect(line.length).toBeLessThanOrEqual(200)
    expect(line.endsWith("; 4 parts; NOT verified")).toBe(true)
  })

  test("use_module copies the sheet beside the circuit and says how to place it; a different sheet of that name is refused", async () => {
    const call = await connect(first)
    await board(call)
    await call("save_module", { file: "Input.sheet.tsx" })
    const other = await connect(second)
    await mkdir(join(second, "boards"))
    const used = await other("use_module", { module: "Input", file: "boards/next.circuit.tsx" })
    expect(used.text).toBe('Copied Input.sheet.tsx into the project. Add it with edit_circuit: add_instance { sheet: "Input", name, connections: { IN, OUT, GND } }')
    expect(await readFile(join(second, "boards", "Input.sheet.tsx"), "utf8")).toBe(await readFile(join(shelf, "Input", "Input.sheet.tsx"), "utf8"))
    expect((await other("use_module", { module: "Input", file: "boards/next.circuit.tsx" })).isError).toBe(false)
    await writeFile(join(second, "boards", "Input.sheet.tsx"), "export default function Input() { return <sheet /> }\n")
    const refused = await other("use_module", { module: "Input", file: "boards/next.circuit.tsx" })
    expect(refused).toMatchObject({ isError: true })
    expect(refused.text).toContain("already")
  })

  test("the full round trip: a described block saved, used in an empty project, placed, checked clean", async () => {
    const call = await connect(first)
    await board(call)
    expect((await call("save_module", { file: "Input.sheet.tsx" })).isError).toBe(false)
    const other = await connect(second)
    const made = await other("new_circuit", { file: "io.circuit.tsx", parts: [{ name: "J1", kind: "pinheader", props: { pinCount: 3 } }], nets: { A: ["J1.pin1"], B: ["J1.pin2"], GND: ["J1.pin3"] }, place: false })
    expect(made.isError, made.text).toBe(false)
    expect((await other("list_modules")).text).toContain("Input: 24 V digital input")
    expect((await other("use_module", { module: "Input", file: "io.circuit.tsx" })).isError).toBe(false)
    const placed = await other("edit_circuit", { file: "io.circuit.tsx", edits: [{ add_instance: { sheet: "Input", name: "CH1", connections: { IN: "A", OUT: "B", GND: "GND" } } }] })
    expect(placed.isError, placed.text).toBe(false)
    const checked = await other("check_circuit", { file: "io.circuit.tsx" })
    expect(checked.text).toMatch(/: 0 errors/)
  })

  test("no tool verifies a module", async () => {
    const call = await connect(first)
    const names = (await (async () => {
      const server = createCopperflowServer(first, { engine: inProcessEngine })
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
      const client = new Client({ name: "t", version: "0" })
      await Promise.all([server.connect(serverSide), client.connect(clientSide)])
      return (await client.listTools()).tools.map((tool) => tool.name)
    })())
    expect(names.filter((name) => /verif/.test(name))).toEqual([])
    expect(call).toBeDefined()
  })
})

describe("copperflow modules, for a person", () => {
  const io = (answer?: string) => {
    const out: string[] = []
    return { out, io: { out: (text: string) => void out.push(text), err: (text: string) => void out.push(text), ...(answer === undefined ? {} : { ask: async () => answer }) } }
  }

  test("verify marks the module with a hash of its sheet; a changed sheet reads NOT verified again; remove takes it off", async () => {
    const call = await connect(first)
    await board(call)
    await call("save_module", { file: "Input.sheet.tsx" })
    const noTerminal = io()
    expect(await runCli(["modules", "verify", "Input", "--by", "Ada"], first, noTerminal.io as never)).toBe(1)
    const asked = io("Input")
    expect(await runCli(["modules", "verify", "Input", "--by", "Ada"], first, asked.io as never)).toBe(0)
    expect(asked.out.join("\n")).toContain("Input is verified by Ada")
    expect((await call("list_modules")).text).toMatch(/; verified by Ada$/)
    const listing = io()
    await runCli(["modules"], first, listing.io as never)
    expect(listing.out.join("\n")).toContain("verified by Ada")
    const sheet = join(shelf, "Input", "Input.sheet.tsx")
    await writeFile(sheet, (await readFile(sheet, "utf8")).replace("10k", "12k"))
    expect((await call("list_modules")).text).toMatch(/; NOT verified$/)
    const removed = io()
    expect(await runCli(["modules", "remove", "Input"], first, removed.io as never)).toBe(0)
    expect(await readdir(shelf)).toEqual([])
  })
})

describe("names and links cannot leave the shelf", () => {
  const HOSTILE = ["../x", "..", "a/b", "a\\b", "C:x", "/abs", ".hidden", "1abc", "", "CON", "nul", "a".repeat(80), "a b", "x.."]

  test("every hostile name is refused by every tool and command", async () => {
    const call = await connect(first)
    await board(call)
    for (const name of HOSTILE) {
      const saved = await call("save_module", { file: "Input.sheet.tsx", name })
      expect(saved.isError, `save ${name}`).toBe(true)
      expect((await call("list_modules", { name })).isError, `info ${name}`).toBe(true)
      expect((await call("use_module", { module: name, file: "main.circuit.tsx" })).isError, `use ${name}`).toBe(true)
      expect(await runCli(["modules", "remove", name], first, { out: () => undefined, err: () => undefined } as never), `remove ${name}`).toBe(1)
    }
    expect(await readdir(shelf)).toEqual([])
    const outside = await call("save_module", { file: "../elsewhere/Input.sheet.tsx" })
    expect(outside.isError).toBe(true)
    expect((await call("use_module", { module: "Input", file: "../elsewhere/x.circuit.tsx" })).isError).toBe(true)
  })

  test("a module folder that is a link is refused, and nothing is written through it", async () => {
    const call = await connect(first)
    await board(call)
    const target = await mkdtemp(join(tmpdir(), "cf-target-"))
    await symlink(target, join(shelf, "Input"), "junction")
    expect((await lstat(join(shelf, "Input"))).isSymbolicLink()).toBe(true)
    const saved = await call("save_module", { file: "Input.sheet.tsx", replace: true })
    expect(saved).toMatchObject({ isError: true })
    expect(saved.text).toContain("link")
    expect(await readdir(target)).toEqual([])
    expect((await call("list_modules", { name: "Input" })).isError).toBe(true)
    expect((await call("use_module", { module: "Input", file: "main.circuit.tsx" })).isError).toBe(true)
    expect(await runCli(["modules", "remove", "Input"], first, { out: () => undefined, err: () => undefined } as never)).toBe(1)
    expect((await lstat(target)).isDirectory()).toBe(true)
    expect((await call("list_modules")).text).not.toContain("Input:")
  })
})
