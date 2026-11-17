// The library that ships in the package (library/modules): every module is plain, described, not verified by
// anyone, and can be brought into a fresh project and placed there without an error.
import { afterEach, beforeEach, expect, test } from "vitest"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { checkPlainSheet } from "../src/core/plain-sheet.js"
import { readCard } from "../src/core/sheet-card.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const LIBRARY = resolve("library")
const MODULES = join(LIBRARY, "modules")
const names = readdirSync(MODULES).sort()
const KEYS = ["COPPERFLOW_HOME", "COPPERFLOW_MODULES", "COPPERFLOW_BUILTIN_LIBRARY"] as const
const saved = KEYS.map((key) => process.env[key])

beforeEach(async () => {
  process.env["COPPERFLOW_HOME"] = await mkdtemp(join(tmpdir(), "cf-home-"))
  process.env["COPPERFLOW_MODULES"] = await mkdtemp(join(tmpdir(), "cf-shelf-"))
  process.env["COPPERFLOW_BUILTIN_LIBRARY"] = LIBRARY
})

afterEach(() => {
  KEYS.forEach((key, i) => {
    if (saved[i] === undefined) delete process.env[key]
    else process.env[key] = saved[i]
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

test("the library ships the three first modules", () => {
  expect(names).toEqual(["CanNode", "DigitalInput24V", "RelayDriver"])
})

test.each(names)("%s is a plain, described sheet that nobody has verified for the person", (name) => {
  const folder = join(MODULES, name)
  const text = readFileSync(join(folder, `${name}.sheet.tsx`), "utf8")
  expect(text).not.toContain("\r")
  expect(checkPlainSheet(text).name).toBe(name)
  const card = readCard(text)
  expect(card.does?.length ?? 0).toBeGreaterThan(20)
  expect(card.ports.length).toBeGreaterThan(0)
  for (const port of card.ports) expect(port.carries ?? port.type, `${name}.${port.name}`).toBeTruthy()
  expect(existsSync(join(folder, "verified.json"))).toBe(false)
  expect(JSON.parse(readFileSync(join(folder, "module.json"), "utf8")).savedFrom).toBe("copperflow library")
})

test.each(names)("%s is listed, read and used from a fresh project, and one instance of it has no error", async (name) => {
  const root = await mkdtemp(join(tmpdir(), "cf-builtin-"))
  const call = await connect(root)
  expect((await call("list_modules", { filter: name })).text).toContain(`copperflow/${name}: `)
  const info = (await call("module_info", { name: `copperflow/${name}` })).text
  expect(info).toContain("NOT verified")
  expect(info).toContain("Plain: use_module can bring it into a project")
  const ports = readCard(readFileSync(join(MODULES, name, `${name}.sheet.tsx`), "utf8")).ports.map((port) => port.name)
  const nets = Object.fromEntries(ports.map((port, i) => [port, [`J1.pin${i + 1}`]]))
  const made = await call("new_circuit", { file: "main.circuit.tsx", parts: [{ name: "J1", kind: "pinheader", props: { pinCount: ports.length } }], nets, place: false })
  expect(made.isError, made.text).toBe(false)
  const used = await call("use_module", { module: `copperflow/${name}`, file: "main.circuit.tsx" })
  expect(used.isError, used.text).toBe(false)
  expect(used.text).toContain("from library copperflow (NOT verified)")
  const connections = Object.fromEntries(ports.map((port) => [port, port]))
  const placed = await call("edit_circuit", { file: "main.circuit.tsx", edits: [{ add_instance: { sheet: name, name: "A", connections } }] })
  expect(placed.isError, placed.text).toBe(false)
  expect((await call("check_circuit", { file: "main.circuit.tsx" })).text).toMatch(/: 0 errors/)
})
