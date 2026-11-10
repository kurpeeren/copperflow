import { expect, test } from "vitest"
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EditError } from "../src/core/edit-error.js"
import { historyDir, listHistory } from "../src/core/history.js"
import { applyLayoutEdits } from "../src/core/layout-edits.js"
import { createCircuitFile, editCircuit } from "../src/core/workspace.js"

const FILE = "a.circuit.tsx"
const CIRCUIT = `export default () => (
  <board width="30mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-5} pcbY={0} />
  </board>
)
`
const BAD = "agent" as never

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cf-author-"))
  await writeFile(join(root, FILE), CIRCUIT)
  return root
}

const entryFiles = (root: string) => readdir(historyDir(root)).catch(() => [])

test("editCircuit refuses an unknown author, leaves the file alone and writes no entry", async () => {
  const root = await project()
  const edit = editCircuit(root, FILE, [{ kind: "setProps", part: "R1", props: { pcbX: 3 } }], { author: BAD, summary: "move" })
  await expect(edit).rejects.toBeInstanceOf(EditError)
  await expect(edit).rejects.toThrow(/author/)
  expect(await readFile(join(root, FILE), "utf8")).toBe(CIRCUIT)
  expect(await entryFiles(root)).toEqual([])
  expect((await listHistory(root, 10)).problems).toEqual([])
})

test("createCircuitFile refuses an unknown author before writing the circuit or its sheets", async () => {
  const root = await project()
  await mkdir(join(root, "x"))
  const made = createCircuitFile(root, "x/b.circuit.tsx", CIRCUIT, { author: BAD, summary: "create", sheets: [{ file: "x/s.circuit.tsx", text: CIRCUIT }] })
  await expect(made).rejects.toBeInstanceOf(EditError)
  expect(await readdir(join(root, "x"))).toEqual([])
  expect(await entryFiles(root)).toEqual([])
})

test("applyLayoutEdits refuses an unknown author and writes no layout file", async () => {
  const root = await project()
  const edits = [{ kind: "addTrack", net: "R1.pin1", layer: "top", width: 0.25, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] as never
  await expect(applyLayoutEdits(root, FILE, edits, { author: BAD })).rejects.toBeInstanceOf(EditError)
  expect((await readdir(root)).sort()).toEqual([FILE])
})
