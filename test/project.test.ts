import { beforeEach, describe, expect, test } from "vitest"
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { listEntries, redoChange, undoChange } from "../src/core/index.js"
import { noteDecision, setProject } from "../src/core/project.js"
import { appendToSection, EMPTY_PROJECT, sectionLines, sectionText, withSection } from "../src/core/project-text.js"
import type { HistoryListing } from "../src/core/history.js"
import { changesOf } from "../src/mcp/project-tools.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const EXAMPLE = fileURLToPath(new URL("../examples/usb-c-ldo", import.meta.url))
const WRITTEN = `# CAN module

Some notes a person wrote.

## Intent

A CAN node for the bench.

## Blocks

- CAN: MCP2515 + TJA1051 (placed)

## Decisions

- 2026-11-01 3.3 V only

## Open

- route the board

## Links

http://example.invalid/datasheet
`

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-project-"))
})

describe("PROJECT.md text", () => {
  test("appending under Decisions keeps every other byte", () => {
    const after = appendToSection(WRITTEN, "Decisions", "- 2026-11-11 TJA1051 over MCP2551")
    const [head, rest] = [WRITTEN.slice(0, WRITTEN.indexOf("- 2026-11-01")), WRITTEN.slice(WRITTEN.indexOf("## Open"))]
    expect(after.startsWith(head)).toBe(true)
    expect(after.endsWith(rest)).toBe(true)
    expect(sectionLines(after, "Decisions")).toEqual(["2026-11-01 3.3 V only", "2026-11-11 TJA1051 over MCP2551"])
  })

  test("rewriting a section changes only that section; a missing one is added at the end", () => {
    const after = withSection(WRITTEN, "Intent", "A two-channel sensor board.")
    expect(after.replace("A two-channel sensor board.", "A CAN node for the bench.")).toBe(WRITTEN)
    const added = withSection("# P\n", "Open", "- all of it")
    expect(added).toBe("# P\n\n## Open\n\n- all of it\n\n")
    expect(sectionText(EMPTY_PROJECT, "Intent")).toBe("")
    expect(withSection(added, "Open", "- all of it")).toBe(added)
  })

  test("a CRLF file: its sections are found, not added again", () => {
    const crlf = WRITTEN.replace(/\n/g, "\r\n")
    const rewritten = withSection(crlf, "Intent", "A two-channel sensor board.")
    expect(rewritten.match(/^## Intent/gm)).toHaveLength(1)
    expect(sectionText(rewritten, "Intent")).toBe("A two-channel sensor board.")
    const appended = appendToSection(crlf, "Decisions", "- 2026-11-11 TJA1051")
    expect(appended.match(/^## Decisions/gm)).toHaveLength(1)
    expect(sectionLines(appended, "Decisions")).toEqual(["2026-11-01 3.3 V only", "2026-11-11 TJA1051"])
    expect(appended.endsWith(crlf.slice(crlf.indexOf("## Open")))).toBe(true)
    for (const text of [rewritten, appended, withSection(crlf, "Open", "- a\n- b")]) expect(text).not.toMatch(/[^\r]\n/)
  })

  test("headings are found whatever their case", () => {
    const lower = "# P\n\n## intent\n\nOld.\n\n## decisions\n\n- one\n"
    const after = appendToSection(withSection(lower, "Intent", "New."), "Decisions", "- two")
    expect(after).toBe("# P\n\n## intent\n\nNew.\n\n## decisions\n\n- one\n- two\n\n")
  })

  test("appending keeps blank lines a person left inside Decisions", () => {
    const spaced = "## Decisions\n\n- one\n\n- two\n\n## Open\n"
    expect(appendToSection(spaced, "Decisions", "- three")).toBe("## Decisions\n\n- one\n\n- two\n- three\n\n## Open\n")
  })
})

describe("the last changes of a circuit", () => {
  const entry = (id: string, file: string, also: string[] = []) =>
    ({ id, time: "2026-11-11T10:00:00Z", author: "ai", summary: id, file, undone: false, ...(also.length ? { also: also.map((f) => ({ file: f })) } : {}) }) as unknown as HistoryListing
  test("include changes to its layout file, its sheet files, and those written alongside it", () => {
    const history = [
      entry("c0006", "other.circuit.tsx"),
      entry("c0005", "main.circuit.layout.json"),
      entry("c0004", "Stage.sheet.tsx"),
      entry("c0003", "Other.sheet.tsx"),
      entry("c0002", "other.circuit.tsx", ["main.circuit.tsx"]),
      entry("c0001", "main.circuit.tsx"),
    ]
    expect(changesOf("main.circuit.tsx", ["Stage.sheet.tsx"], history).map((e) => e.id)).toEqual(["c0005", "c0004", "c0002", "c0001"])
  })
})

describe("PROJECT.md on disk", () => {
  test("the first change creates the file with the four sections, as one entry the undo removes", async () => {
    const entry = await noteDecision(root, "Use 0603 passives", { author: "ai", now: new Date("2026-11-11T10:00:00Z") })
    const text = await readFile(join(root, "PROJECT.md"), "utf8")
    expect(text).toBe("# Project\n\n## Intent\n\n## Blocks\n\n## Decisions\n\n- 2026-11-11 Use 0603 passives\n\n## Open\n\n")
    expect(entry).toMatchObject({ author: "ai", file: "PROJECT.md", absent: "before" })
    await undoChange(root, { author: "ai" })
    expect(existsSync(join(root, "PROJECT.md"))).toBe(false)
    await redoChange(root, { author: "ai" })
    expect(await readFile(join(root, "PROJECT.md"), "utf8")).toBe(text)
  })

  test("set_project rewrites the sections as one entry by the author given, and the undo restores the text", async () => {
    await writeFile(join(root, "PROJECT.md"), WRITTEN)
    await setProject(root, { intent: "New intent.", blocks: [{ name: "PSU", does: "LDO 5 V to 3.3 V", status: "designed" }], open: ["fit the board"] }, { author: "human" })
    const text = await readFile(join(root, "PROJECT.md"), "utf8")
    expect(sectionText(text, "Intent")).toBe("New intent.")
    expect(sectionLines(text, "Blocks")).toEqual(["PSU: LDO 5 V to 3.3 V (designed)"])
    expect(sectionLines(text, "Open")).toEqual(["fit the board"])
    expect(text.startsWith("# CAN module\n\nSome notes a person wrote.\n\n## Intent\n")).toBe(true)
    expect(text).toContain("## Decisions\n\n- 2026-11-01 3.3 V only\n\n## Open")
    expect(text.endsWith("## Links\n\nhttp://example.invalid/datasheet\n")).toBe(true)
    const entries = await listEntries(root, 10)
    expect(entries.map((e) => [e.author, e.file])).toEqual([["human", "PROJECT.md"]])
    await undoChange(root, { author: "human" })
    expect(await readFile(join(root, "PROJECT.md"), "utf8")).toBe(WRITTEN)
  })

  test("refuses a heading inside a section and an empty update", async () => {
    await expect(setProject(root, { intent: "## Sneaky" }, { author: "ai" })).rejects.toThrow(/heading/)
    await expect(setProject(root, {}, { author: "ai" })).rejects.toThrow(/Give intent/)
    expect(existsSync(join(root, "PROJECT.md"))).toBe(false)
  })
})

describe("the project tools", () => {
  let client: Client
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args })
    return { text: (result.content as Array<{ text: string }>).map((c) => c.text).join("\n"), isError: result.isError === true }
  }

  beforeEach(async () => {
    await cp(EXAMPLE, root, { recursive: true })
    await writeFile(join(root, "second.circuit.tsx"), `export default () => (\n  <board width="20mm" height="10mm">\n    <resistor name="R1" resistance="1k" footprint="0603" pcbX={3} pcbY={3} />\n  </board>\n)\n`)
    const server = createCopperflowServer(root, { engine: inProcessEngine as never })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: "test", version: "0.0.0" })
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  })

  test("the tool shapes", async () => {
    const { tools } = await client.listTools()
    const tool = (name: string) => tools.find((t) => t.name === name)
    expect(Object.keys(tool("project_status")?.inputSchema.properties ?? {})).toEqual([])
    expect(tool("project_status")?.annotations).toMatchObject({ readOnlyHint: true })
    expect(tool("project_status")?.description).toMatch(/first/)
    expect(Object.keys(tool("note_decision")?.inputSchema.properties ?? {})).toEqual(["file", "text"])
    expect(tool("note_decision")?.inputSchema.required).toEqual(["text"])
    expect(Object.keys(tool("set_project")?.inputSchema.properties ?? {})).toEqual(["intent", "blocks", "open"])
    expect(Object.keys(tool("board_summary")?.inputSchema.properties ?? {})).toEqual(["file", "detail"])
    expect(tool("board_summary")?.inputSchema.required).toEqual(["file"])
  })

  test("project_status on a project with two circuits: the sections, the counts and the last changes", async () => {
    expect((await call("project_status")).text).toMatch(/^No PROJECT\.md yet/)
    expect((await call("set_project", { intent: "A USB-C supply.", blocks: [{ name: "PSU", does: "LDO", status: "placed" }], open: ["route"] })).text).toMatch(/^Change c\d{4}: Intent, Blocks, Open written to PROJECT\.md$/)
    for (let i = 1; i <= 6; i++) await call("note_decision", { text: `decision ${i}` })
    await call("set_props", { file: "second.circuit.tsx", part: "R1", props: { pcbX: 4 } })
    const { text, isError } = await call("project_status")
    expect(isError).toBe(false)
    const lines = text.split("\n")
    expect(lines[0]).toBe("Intent: A USB-C supply.")
    expect(lines).toContain("  PSU: LDO (placed)")
    expect(text).toMatch(/^Decisions \(last 5 of 6\):$/m)
    expect(text).not.toMatch(/decision 1$/m)
    expect(text).toMatch(/decision 6$/m)
    expect(lines).toContain("  route")
    expect(text).toMatch(/^Circuits \(2\):$/m)
    expect(lines).toContain("index.circuit.tsx: parts 9, nets 6, unplaced 0, unrouted 22, errors 0, warnings 1")
    expect(lines).toContain("second.circuit.tsx: parts 1, nets 0, unplaced 0, unrouted 0, errors 0, warnings 2")
    expect(text).toMatch(/^ {2}c\d{4} \d{4}-\d\d-\d\d ai: set R1 pcbX=4$/m)
    expect(lines.length).toBeLessThan(40)
  })

  test("note_decision names the circuit the decision is about in its line", async () => {
    expect((await call("note_decision", { file: "second.circuit.tsx", text: "R1 at the edge for the probe" })).text).toMatch(/^Change c\d{4}: noted under Decisions in PROJECT\.md$/)
    await call("note_decision", { text: "3.3 V only" })
    const lines = sectionLines(await readFile(join(root, "PROJECT.md"), "utf8"), "Decisions")
    expect(lines).toEqual([expect.stringMatching(/^\d{4}-\d\d-\d\d second\.circuit\.tsx: R1 at the edge for the probe$/), expect.stringMatching(/^\d{4}-\d\d-\d\d 3\.3 V only$/)])
    const missing = await call("note_decision", { file: "nope.circuit.tsx", text: "x" })
    expect(missing.isError).toBe(true)
  })

  test("board_summary answers through the server", async () => {
    const { text, isError } = await call("board_summary", { file: "second.circuit.tsx" })
    expect(isError).toBe(false)
    expect(text).toMatch(/^second\.circuit\.tsx: Board 20\.0 × 10\.0 mm, 2 layers/)
    expect(text).toMatch(/^R1 1k 0603 @\(3\.0, 3\.0\) r0 top$/m)
  })
})
