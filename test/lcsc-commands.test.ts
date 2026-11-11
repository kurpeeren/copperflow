// copperflow parts import and the MCP tool import_part, with fetches answered from copperflow's own fixtures.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { runCli } from "../src/cli-commands.js"
import { readPart } from "../src/core/library.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { fixtureFetch, noNetwork, offlineFetch } from "./helpers/lcsc-fixtures.js"

let root: string
let out: string[]
let err: string[]

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-lcsc-cmd-"))
  out = []
  err = []
  vi.stubGlobal("fetch", noNetwork)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const cli = (get: typeof fetch, ...args: string[]) =>
  runCli(args, root, { out: (s) => out.push(s), err: (s) => err.push(s) }, { engine: inProcessEngine, fetch: get })

describe("copperflow parts import", () => {
  test("imports the part, says what it wrote, and the library lists it as imported and not verified", async () => {
    expect(await cli(fixtureFetch(), "parts", "import", "C2838500")).toBe(0)
    const said = out.join("\n")
    expect(said).toContain("Imported C2838500 as ESP32-C3: ESP32-C3, QFN-32_L5.0-W5.0-P0.50-TL-EP3.7, 33 pins, 33 pads.")
    expect(said).toContain("It is NOT verified: check every pin and pad in parts/ESP32-C3/verification.md against the datasheet.")
    expect(said).toContain("personal, non-commercial use only")
    out = []
    expect(await cli(fixtureFetch(), "parts")).toBe(0)
    expect(out.join("\n")).toBe("ESP32-C3  <ESP32_C3>  ESP32-C3, QFN-32_L5.0-W5.0-P0.50-TL-EP3.7  footprint.yaml  not verified  lcsc C2838500, imported " + new Date().toISOString().slice(0, 10))
  })

  test("--id names the part; an existing id needs --replace", async () => {
    expect(await cli(fixtureFetch(), "parts", "import", "C7950", "--id", "OPAMP")).toBe(0)
    expect(await cli(fixtureFetch(), "parts", "import", "C7950", "--id", "OPAMP")).toBe(1)
    expect(err.join("\n")).toContain("Part OPAMP already exists; import again with replace (--replace) to overwrite it")
    expect(await cli(fixtureFetch(), "parts", "import", "C7950", "--id", "OPAMP", "--replace")).toBe(0)
    expect((await readPart(root, "OPAMP")).mpn).toBe("LM358DR2G")
  })

  test("offline it says so, exits 1 and writes nothing; without a number it says how", async () => {
    expect(await cli(offlineFetch, "parts", "import", "C7950")).toBe(1)
    expect(err.join("\n")).toContain("Importing needs an internet connection; nothing was written.")
    expect(await readdir(root)).toEqual([])
    expect(await cli(fixtureFetch(), "parts", "import")).toBe(1)
    expect(err.at(-1)).toContain("Missing LCSC part number")
  })

  test("--help prints the usage; unknown options and a second number are refused before any fetch", async () => {
    const get = fixtureFetch()
    expect(await cli(get, "parts", "import", "--help")).toBe(0)
    expect(out.at(-1)).toBe("Usage: copperflow parts import <C-number> [--id <id>] [--replace]")
    expect(await cli(get, "parts", "import", "C7950", "--idd", "X")).toBe(1)
    expect(err.at(-1)).toContain('Unknown option "--idd" for parts import')
    expect(await cli(get, "parts", "import", "C7950", "C158012")).toBe(1)
    expect(err.at(-1)).toContain("parts import takes one LCSC part number (got C7950, C158012)")
    expect(get.calls).toEqual([])
  })
})

describe("MCP import_part", () => {
  async function connect(get: typeof fetch): Promise<Client> {
    const server = createCopperflowServer(root, { engine: inProcessEngine, fetch: get })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: "test", version: "0.0.0" })
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
    return client
  }
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args })
    return { text: (result.content as Array<{ text: string }>).map((c) => c.text).join("\n"), isError: result.isError === true }
  }

  test("imports by LCSC number; list_parts shows the origin", async () => {
    const client = await connect(fixtureFetch())
    const imported = await call(client, "import_part", { lcsc: "C158012", id: "XH2" })
    expect(imported.isError).toBe(false)
    expect(imported.text).toContain("Imported C158012 as XH2")
    expect(imported.text).toContain('Use it with place_part (part "XH2")')
    expect((await call(client, "list_parts")).text).toMatch(/^XH2 {2}<XH2> {2}B2B-XH-A \(LF\)\(SN\), CONN-TH_B2B-XH-A-LF-SN {2}footprint\.yaml {2}NOT verified {2}lcsc C158012, imported \d{4}-\d{2}-\d{2}$/)
    const again = await call(client, "import_part", { lcsc: "C158012", id: "XH2" })
    expect(again).toMatchObject({ isError: true })
    expect((await call(client, "import_part", { lcsc: "C158012", id: "XH2", replace: true })).isError).toBe(false)
  })

  test("offline is an error that says nothing was written", async () => {
    const client = await connect(offlineFetch)
    const result = await call(client, "import_part", { lcsc: "C7950" })
    expect(result.isError).toBe(true)
    expect(result.text).toContain("nothing was written")
  })

  test("the tool says the part is unverified and names the source's terms", async () => {
    const { tools } = await (await connect(fixtureFetch())).listTools()
    const description = tools.find((tool) => tool.name === "import_part")?.description ?? ""
    expect(description).toMatch(/NOT verified/)
    expect(description).toMatch(/JLCEDA\/EasyEDA/)
  })
})
