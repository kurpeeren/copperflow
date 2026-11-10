import { beforeEach, describe, expect, test } from "vitest"
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { loadCircuit, updateAnnotations } from "../src/core/workspace.js"
import { listEntries } from "../src/core/index.js"
import { addMark, lockParts } from "../src/core/annotations.js"
import { BOARD, LDO, SHARED } from "./fixtures.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "main.circuit.tsx"
const EXAMPLE = fileURLToPath(new URL("../examples/usb-c-ldo", import.meta.url))
const NOW = "2026-11-09T10:00:00.000Z"
let root: string
let client: Client

async function connect(engine: object = inProcessEngine) {
  const server = createCopperflowServer(root, { engine: engine as never })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}

async function lock(...parts: string[]) {
  const { model } = await loadCircuit(root, FILE)
  await updateAnnotations(root, FILE, (a) => lockParts(a, model, parts, NOW))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-compact-"))
  await writeFile(join(root, FILE), BOARD)
  await writeFile(join(root, "shared.ts"), SHARED)
  await connect()
})

describe("compact circuit_summary", () => {
  test("is a header, a line per part and a line per net", async () => {
    const lines = (await call("circuit_summary", { file: FILE })).text.split("\n")
    expect(lines[0]).toBe("main.circuit.tsx: 5 parts, 2 nets, 2 traces, 0 locked")
    expect(lines).toContain("R1 resistor 5.1k 0402 pcb(-4,2)")
    expect(lines).toContain("GND: R1.pin1")
    expect(lines).toContain("(unnamed): C1.pin1 R1.pin2")
    expect(lines).toContain("Lock violations: none")
  })

  test("detail full gives the old output", async () => {
    const { text } = await call("circuit_summary", { file: FILE, detail: "full" })
    expect(text).toContain("Parts:")
    expect(text).toContain('<resistor> resistance="5.1k"')
  })

  test("shows locks and marks, one line each", async () => {
    await lock("R1")
    await updateAnnotations(root, FILE, (a) => addMark(a, { text: "keep\nclear", view: "pcb", x: 1, y: 2 }, NOW).annotations)
    const { text } = await call("circuit_summary", { file: FILE })
    expect(text).toContain("R1 resistor 5.1k 0402 pcb(-4,2) [LOCKED]")
    expect(text).toContain("Locked: R1")
    expect(text).toMatch(/Mark \S+ \(pcb 1, 2\): keep clear/)
  })

  test("the Locked line is cut at 20 names", async () => {
    const parts = Array.from({ length: 25 }, (_, i) => `<resistor name="R${i + 1}" resistance="1k" />`).join("\n")
    await writeFile(join(root, "big.circuit.tsx"), `export default () => (
<board>
${parts}
</board>
)
`)
    const { model } = await loadCircuit(root, "big.circuit.tsx")
    await updateAnnotations(root, "big.circuit.tsx", (a) => lockParts(a, model, model.parts.map((p) => p.name), NOW))
    const locked = (await call("circuit_summary", { file: "big.circuit.tsx" })).text.split("\n").find((l) => l.startsWith("Locked:"))
    expect(locked).toContain('… and 5 more (detail: "full")')
  })

  test("the demo circuit fits a screen", async () => {
    await cp(EXAMPLE, root, { recursive: true })
    const compact = (await call("circuit_summary", { file: "index.circuit.tsx" })).text
    const full = (await call("circuit_summary", { file: "index.circuit.tsx", detail: "full" })).text
    expect(compact.split("\n").length).toBeLessThan(60)
    expect(compact.length).toBeLessThan(full.length)
    expect(compact).toMatch(/^GND: .*J1\.GND1/m)
    expect(compact).toMatch(/^index\.circuit\.tsx: \d+ parts, \d+ nets, \d+ traces, 0 locked/)
  })

  test("a list of more than 20 parts is cut with a count", async () => {
    const parts = Array.from({ length: 25 }, (_, i) => `<resistor name="R${i + 1}" resistance="1k" />`).join("\n")
    await writeFile(join(root, "big.circuit.tsx"), `export default () => (\n<board>\n${parts}\n</board>\n)\n`)
    const lines = (await call("circuit_summary", { file: "big.circuit.tsx" })).text.split("\n")
    expect(lines[0]).toContain("25 parts")
    expect(lines).toContain('… and 5 more (detail: "full")')
    expect(lines.filter((l) => l.startsWith("R"))).toHaveLength(20)
  })
})

const POWER_STAGE = `export default function PowerStage() {
  return (
    <sheet>
      <port name="VIN" />
      <port name="VOUT" />
      <port name="GND" />
      <chip name="U1" pinLabels={{ pin1: "IN", pin2: "OUT", pin3: "GND" }} />
      <capacitor name="C1" capacitance="1uF" footprint="0402" />
      <resistor name="R1" resistance="10k" />
      <resistor name="R2" resistance="10k" />
      <trace from="U1.IN" to="net.VIN" />
      <trace from="U1.OUT" to="net.VOUT" />
      <trace from="U1.GND" to="net.GND" />
      <trace from="C1.pin1" to="net.VOUT" />
      <trace from="R1.pin1" to="net.VOUT" />
      <trace from="R1.pin2" to="net.FB" />
      <trace from="R2.pin1" to="net.FB" />
    </sheet>
  )
}
`

const WITH_SHEETS = `import PowerStage from "./PowerStage.sheet"
export default () => (
  <board width="40mm" height="40mm">
    <PowerStage name="PS1" connections={{ VIN: "VBUS", VOUT: "V3_3", GND: "GND" }} />
    <PowerStage name="PS2" connections={{ VIN: "V3_3", GND: "GND" }} />
    <resistor name="R1" resistance="1k" />
    <trace from="R1.pin1" to="net.VBUS" />
  </board>
)
`

describe("compact circuit_summary with sub-sheets", () => {
  beforeEach(async () => {
    await writeFile(join(root, "PowerStage.sheet.tsx"), POWER_STAGE)
    await writeFile(join(root, "sheets.circuit.tsx"), WITH_SHEETS)
  })

  test("shows each instance in one line and its parts by their flattened designators", async () => {
    const lines = (await call("circuit_summary", { file: "sheets.circuit.tsx" })).text.split("\n")
    expect(lines[0]).toMatch(/^sheets\.circuit\.tsx: 9 parts, 2 instances, \d+ nets, 1 traces, 0 locked$/)
    expect(lines).toContain("PS1 PowerStage base 100: VIN=VBUS VOUT=V3_3 GND=GND, 4 parts")
    expect(lines).toContain("PS2 PowerStage base 200: VIN=V3_3 VOUT=(open) GND=GND, 4 parts")
    expect(lines).toContain("C101 capacitor 1uF 0402 in PS1 as C1")
    expect(lines).toContain("R202 resistor 10k in PS2 as R2")
    expect(lines).toContain("R1 resistor 1k")
    expect(lines.some((l) => l.startsWith("PS1 PowerStage") && l.includes("@"))).toBe(false)
  })

  test("nets are the flattened design's: ports join the parent nets, local nets carry the instance", async () => {
    const lines = (await call("circuit_summary", { file: "sheets.circuit.tsx" })).text.split("\n")
    expect(lines).toContain("VBUS: R1.pin1 U101.pin1")
    expect(lines).toContain("PS1/FB: R101.pin2 R102.pin1")
    expect(lines).toContain("V3_3: C101.pin1 R101.pin1 U101.pin2 U201.pin1")
  })

  test("a locked instance is marked on its line", async () => {
    const { model } = await loadCircuit(root, "sheets.circuit.tsx")
    await updateAnnotations(root, "sheets.circuit.tsx", (a) => lockParts(a, model, ["PS1"], NOW))
    const lines = (await call("circuit_summary", { file: "sheets.circuit.tsx" })).text.split("\n")
    expect(lines).toContain("PS1 PowerStage base 100: VIN=VBUS VOUT=V3_3 GND=GND, 4 parts [LOCKED]")
    expect(lines).toContain("Locked: PS1")
  })

  test("a circuit whose build fails still has its summary, with a note", async () => {
    await writeFile(join(root, "PowerStage.sheet.tsx"), "export default function PowerStage() { throw new Error('broken') }\n")
    const { text, isError } = await call("circuit_summary", { file: "sheets.circuit.tsx" })
    expect(isError).toBe(false)
    expect(text).toMatch(/^Sub-sheets not shown: the build failed: .*broken/m)
    expect(text).toContain("PS1 PowerStage")
  })
})

function many(n: number, severity: "error" | "warning", code: string, item: (i: number) => string) {
  return Array.from({ length: n }, (_, i) => ({ id: `${code}${i}`, code, severity, message: `${code} number ${i}`, items: [item(i)], view: "pcb" }))
}

describe("compact check_circuit", () => {
  const engine = (violations: unknown[]) => ({ build: async () => ({ violations, diagnostics: [] }) as never })

  test("counts, then at most 20 lines, errors first, then the rest as a count", async () => {
    await connect(engine([...many(8, "warning", "unrouted", (i) => `R${i}.pin1`), ...many(15, "error", "pin-unconnected", (i) => `U${i}.pin2`)]))
    const lines = (await call("check_circuit", { file: FILE })).text.split("\n")
    expect(lines[0]).toBe("main.circuit.tsx: 15 errors, 8 warnings")
    expect(lines[1]).toBe("error pin-unconnected [U0.pin2]: pin-unconnected number 0")
    expect(lines).toHaveLength(1 + 20 + 1)
    expect(lines[21]).toMatch(/^… and 3 more/)
  })

  test("filter narrows to errors, warnings, a part or a net", async () => {
    await connect(engine([...many(3, "warning", "unrouted", (i) => `R${i}.pin1`), ...many(2, "error", "pin-unconnected", (i) => `U${i}.pin2`)]))
    expect((await call("check_circuit", { file: FILE, filter: "errors" })).text.split("\n")[0]).toContain("2 errors, 0 warnings")
    expect((await call("check_circuit", { file: FILE, filter: "warnings" })).text.split("\n")[0]).toContain("0 errors, 3 warnings")
    const part = (await call("check_circuit", { file: FILE, filter: "R1" })).text.split("\n")
    expect(part).toHaveLength(2)
    expect(part[1]).toContain("R1.pin1")
  })

  test("a part or net filter matches whole designators, so R1 does not match R10", async () => {
    await connect(engine([...many(1, "warning", "a", () => "R1.pin1"), ...many(1, "warning", "b", () => "R10.pin1"), ...many(1, "warning", "c", () => "net.GND")]))
    const lines = (await call("check_circuit", { file: FILE, filter: "R1" })).text.split("\n")
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain("R1.pin1")
    expect((await call("check_circuit", { file: FILE, filter: "GND" })).text.split("\n")).toHaveLength(2)
  })

  test("a clean circuit says so in one line", async () => {
    await connect(engine([]))
    expect((await call("check_circuit", { file: FILE })).text).toBe("main.circuit.tsx: 0 errors, 0 warnings")
  })
})

describe("edit_circuit", () => {
  test("applies several edits as one change with one history entry", async () => {
    const { text, isError } = await call("edit_circuit", {
      file: FILE,
      edits: [
        { set_props: { part: "R1", props: { resistance: "10k" } } },
        { place_part: { part: "resistor", name: "R20", props: { resistance: "1k" } } },
        { connect: { from: "R20.pin1", to: "net.GND" } },
        { disconnect: { from: ".C1 > .pin1", to: ".R1 > .pin2" } },
      ],
    })
    expect(isError).toBe(false)
    expect(text).toMatch(/^Change c0001 applied: 4 edits/)
    const source = await readFile(join(root, FILE), "utf8")
    expect(source).toContain('resistance="10k"')
    expect(source).toContain('<resistor name="R20"')
    expect(source).toContain('from="R20.pin1"')
    expect(source).not.toContain('from=".C1 > .pin1"')
    expect(await listEntries(root, 10)).toHaveLength(1)
  })

  test("stops at a refused edit, writes nothing and says which one and how many were fine", async () => {
    await lock("C1")
    const before = await readFile(join(root, FILE), "utf8")
    const { text, isError } = await call("edit_circuit", {
      file: FILE,
      edits: [
        { set_props: { part: "R1", props: { resistance: "10k" } } },
        { remove_part: { part: "C1" } },
        { set_props: { part: "LED1", props: { color: "green" } } },
      ],
    })
    expect(isError).toBe(true)
    expect(text).toContain("Edit 2 of 3 (remove_part) was refused")
    expect(text).toMatch(/C1/)
    expect(text).toContain("1 edit before it was fine")
    expect(await readFile(join(root, FILE), "utf8")).toBe(before)
    expect(await listEntries(root, 10)).toHaveLength(0)
  })

  test("a batch that sets a library-owned prop names the edit instead of a raw error", async () => {
    await call("create_part", { id: "AP2112K-3.3", part: LDO })
    await call("place_part", { file: FILE, part: "AP2112K-3.3", name: "U5" })
    const before = await readFile(join(root, FILE), "utf8")
    const { text, isError } = await call("edit_circuit", {
      file: FILE,
      edits: [{ set_props: { part: "R1", props: { resistance: "10k" } } }, { set_props: { part: "U5", props: { footprint: "0402" } } }],
    })
    expect(isError).toBe(true)
    expect(text).toContain("Edit 2 of 2 (set_props) was refused: footprint comes from")
    expect(text).toContain("1 edit before it was fine")
    expect(await readFile(join(root, FILE), "utf8")).toBe(before)
  })

  test("a refusal found while converting uses the same wording", async () => {
    const { text } = await call("edit_circuit", {
      file: FILE,
      edits: [{ set_props: { part: "R1", props: { resistance: "10k" } } }, { set_props: { part: "C1", props: { capacitance: "2uF" } } }, { place_part: { part: "nonsense", name: "X1" } }],
    })
    expect(text).toContain("Edit 3 of 3 (place_part) was refused: Unknown part")
    expect(text).toContain("2 edits before it were fine, and nothing was written")
  })

  test("refuses an unknown part before touching the file", async () => {
    const { text, isError } = await call("edit_circuit", { file: FILE, edits: [{ place_part: { part: "nonsense", name: "X1" } }] })
    expect(isError).toBe(true)
    expect(text).toContain("Edit 1 of 1 (place_part) was refused: Unknown part")
  })

  test("an edit with two keys is refused", async () => {
    const { text, isError } = await call("edit_circuit", { file: FILE, edits: [{ remove_part: { part: "R1" }, connect: { from: "a", to: "b" } }] })
    expect(isError).toBe(true)
    expect(text).toContain("Give exactly one of")
  })
})

describe("connect_nets", () => {
  test("writes one connection per pin as one change and skips pins already on the net", async () => {
    const first = await call("connect_nets", { file: FILE, nets: { GND: ["R1.pin1", "C1.pin2", "LED1.pin2"], V3_3: ["R1.pin2", "U1.pin1"] } })
    expect(first.isError).toBe(false)
    expect(first.text).toMatch(/^Change c0001 applied: connected 4 pins \(GND \+2, V3_3 \+2; 1 already connected\)/)
    const source = await readFile(join(root, FILE), "utf8")
    expect(source).toContain('<trace from="C1.pin2" to="net.GND" />')
    expect(source).toContain('<trace from="U1.pin1" to="net.V3_3" />')
    expect(source.match(/net\.GND/g)).toHaveLength(3)
    expect(await listEntries(root, 10)).toHaveLength(1)
  })

  test("a repeat call changes nothing", async () => {
    await call("connect_nets", { file: FILE, nets: { GND: ["C1.pin2"] } })
    const again = await call("connect_nets", { file: FILE, nets: { GND: ["C1.pin2"] } })
    expect(again.text).toMatch(/^Nothing to do/)
    expect(await listEntries(root, 10)).toHaveLength(1)
  })

  test("pins are resolved through the built design: an alias and a trace inside map() count as connected", async () => {
    const source = `export default () => (
  <board width="20mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={0} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" pcbX={5} pcbY={0} />
    <trace from=".R1 > .pin1" to="net.GND" />
    {[1].map((i) => (<trace from=".R2 > .pin1" to="net.VCC" />))}
  </board>
)
`
    await writeFile(join(root, "alias.circuit.tsx"), source)
    const alias = await call("connect_nets", { file: "alias.circuit.tsx", nets: { GND: ["R1.left"], VCC: ["R2.pin1", ".R2 > .pin1"] } })
    expect(alias.text).toMatch(/^Nothing to do/)
    const fresh = await call("connect_nets", { file: "alias.circuit.tsx", nets: { GND: ["R1.left", "R2.right"] } })
    expect(fresh.text).toContain("connected 1 pins (GND +1; 1 already connected)")
  })

  test("the same pin on two nets in one call is refused", async () => {
    const { text, isError } = await call("connect_nets", { file: FILE, nets: { A: ["C1.pin2"], B: ["C1.pin2"] } })
    expect(isError).toBe(true)
    expect(text).toContain("both A and B")
  })

  test("the same pin under two spellings on two nets is refused", async () => {
    const { text, isError } = await call("connect_nets", { file: FILE, nets: { GND: ["C1.pin2"], VCC: ["C1.pin2"] } })
    expect(isError).toBe(true)
    const alias = await call("connect_nets", { file: FILE, nets: { GND: ["R1.left"], VCC: ["R1.pin1"] } })
    expect(alias.isError).toBe(true)
    expect(alias.text).toContain("both GND and VCC")
    expect(text).toContain("both GND and VCC")
  })

  test("a circuit that does not build is refused and nothing is written", async () => {
    await writeFile(join(root, "broken.circuit.tsx"), 'export default () => { throw new Error("boom") }')
    const { text, isError } = await call("connect_nets", { file: "broken.circuit.tsx", nets: { GND: ["R1.pin1"] } })
    expect(isError).toBe(true)
    expect(text).toContain("The circuit does not build, so connect_nets cannot tell which pins are already connected")
    expect(await listEntries(root, 10)).toHaveLength(0)
  })

  test("rejects a bad net name or pin", async () => {
    expect((await call("connect_nets", { file: FILE, nets: { "a b": ["R1.pin1"] } })).isError).toBe(true)
    expect((await call("connect_nets", { file: FILE, nets: { GND: ["R1"] } })).isError).toBe(true)
  })
})

describe("server instructions", () => {
  test("tell the model to write connections, batch edits and check once", () => {
    const text = client.getInstructions() ?? ""
    expect(text).toContain("not positions or wire corners")
    expect(text).toContain("edit_circuit")
    expect(text).toContain("connect_nets")
    expect(text).toContain("check_circuit once at the end")
    expect(text).toContain("[LOCKED]")
  })
})
