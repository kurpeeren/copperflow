import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { changeFiles, projectAt } from "../src/core/change-files.js"
import { readEntries, type HistoryEntry } from "../src/core/history.js"
import { createCircuitFile, redoChange } from "../src/core/workspace.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const BOARD = `export default () => (
  <board width="20mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-4} pcbY={0} schX={0} schY={0} />
    <capacitor name="C1" capacitance="1uF" footprint="0603" pcbX={4} pcbY={0} schX={3} schY={0} />
    <trace from=".R1 > .pin2" to=".C1 > .pin1" />
  </board>
)
`
const MAIN = "io.circuit.tsx"
const LAYOUT = "io.circuit.layout.json"

let root: string
let client: Client
let entries: HistoryEntry[]
const texts: Record<string, string | undefined>[] = []

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args })
  const text = (result.content as Array<{ text: string }>)[0]?.text ?? ""
  if (result.isError) throw new Error(text)
  return text
}
const disk = async (file: string) => readFile(join(root, file), "utf8").catch(() => undefined)
const snapshot = async () => texts.push({ [MAIN]: await disk(MAIN), [LAYOUT]: await disk(LAYOUT) })

beforeAll(async () => {
  // Not made real: on Windows CI the temp folder is a short 8.3 path, and nothing here may depend on its spelling.
  root = await mkdtemp(join(tmpdir(), "cf-change-files-"))
  const server = createCopperflowServer(root, { engine: inProcessEngine })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  await snapshot() // 0: nothing
  await createCircuitFile(root, MAIN, BOARD, { author: "human", summary: "create io.circuit.tsx" })
  await snapshot() // 1: c0001 new circuit
  await call("set_props", { file: MAIN, part: "R1", props: { pcbX: -6 } })
  await snapshot() // 2: c0002 move
  await call("autoroute", { file: MAIN })
  await snapshot() // 3: c0003 autoroute
  await call("undo_change", { id: "c0003" })
  await snapshot() // 4: c0004 undo
  await redoChange(root, { author: "ai" })
  await snapshot() // 5: c0005 redo
  await writeFile(join(root, MAIN), (await disk(MAIN))!.replace('resistance="1k"', 'resistance="2k"'))
  await call("set_props", { file: MAIN, part: "C1", props: { pcbY: 2 } })
  await snapshot() // 6: c0006, after a hand edit
  entries = await readEntries(root)
}, 120_000)

afterAll(async () => {
  await client.close()
  await rm(root, { recursive: true, force: true })
})

describe("the project as it was around a change", () => {
  test("the history has the six changes the tools made", () => {
    expect(entries.map((entry) => entry.id)).toEqual(["c0001", "c0002", "c0003", "c0004", "c0005", "c0006"])
    expect(entries[2]?.file).toBe(LAYOUT)
  })

  test("before and after each change are the texts the files had then", async () => {
    for (const [index, entry] of entries.entries()) {
      const { before, after } = await changeFiles(root, { id: entry.id })
      for (const file of [MAIN, LAYOUT]) {
        if (index === 5 && file === MAIN) continue // the hand edit came between c0005 and c0006
        expect(before.files[file], `${file} before ${entry.id}`).toBe(texts[index]?.[file])
        expect(after.files[file], `${file} after ${entry.id}`).toBe(texts[index + 1]?.[file])
      }
    }
  })

  test("a new circuit has no file before it, and the undo of an autoroute takes the layout file back", async () => {
    const created = await changeFiles(root, { id: "c0001" })
    expect(created.before.files[MAIN]).toBeUndefined()
    expect(created.changed).toEqual([MAIN])
    const undo = await changeFiles(root, { id: "c0004" })
    expect(undo.changed).toEqual([LAYOUT])
    expect(undo.after.files[LAYOUT]).toBe(texts[4]?.[LAYOUT])
  })

  test("a hand edit between two changes breaks the chain: the answer still comes, and names the file it is unsure of", async () => {
    const redo = await changeFiles(root, { id: "c0005" })
    expect(redo.after.unsure).toEqual([MAIN])
    expect(redo.before.unsure).toEqual([MAIN])
    // Up to c0002 every change started from the text the one before left.
    expect((await changeFiles(root, { id: "c0001" })).after.unsure).toEqual([])
    const last = await changeFiles(root, { id: "c0006" })
    expect(last.before.unsure).toEqual([MAIN])
    // Before c0006 the file is what c0005 left: the hand edit is not in it.
    expect(last.before.files[MAIN]).toContain('resistance="1k"')
    expect(last.after.files[MAIN]).toContain('resistance="2k"')
  })

  test("since a change: the state after it against the files on disk now, with the changes it covers", async () => {
    const since = await changeFiles(root, { since: "c0002" })
    expect(since.entries.map((entry) => entry.id)).toEqual(["c0003", "c0004", "c0005", "c0006"])
    expect(since.before.files[MAIN]).toBe(texts[2]?.[MAIN])
    expect(since.after.files[MAIN]).toBe(await disk(MAIN))
    expect(since.after.unsure).toEqual([])
    expect(since.before.unsure).toEqual([MAIN])
    expect(since.changed).toEqual([LAYOUT, MAIN])
  })

  test("an id that is not in the history is refused by name", async () => {
    await expect(changeFiles(root, { id: "c0099" })).rejects.toThrow("No change c0099 in the history")
    await expect(changeFiles(root, { since: "c0099" })).rejects.toThrow("No change c0099 in the history")
  })

  test("the pure part: a file no change wrote is the text on disk", () => {
    expect(projectAt([], { "a.ts": "x" }, 0)).toEqual({ files: { "a.ts": "x" }, unsure: [] })
  })
})
