import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCli } from "../src/cli-commands.js"
import { readAnnotations } from "../src/core/annotations.js"
import { BOARD } from "./fixtures.js"

const FILE = "main.circuit.tsx"
let root: string
let out: string[]
let err: string[]
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) })
const run = (...args: string[]) => runCli(args, root, io())
const sidecar = () => readAnnotations(join(root, "main.circuit.annotations.json"))

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-cli-"))
  await writeFile(join(root, FILE), BOARD)
  out = []
  err = []
})

describe("cli", () => {
  test("lock and unlock change the sidecar", async () => {
    expect(await run("lock", FILE, "R1", "C1")).toBe(0)
    expect((await sidecar()).locks.map((l) => l.part)).toEqual(["R1", "C1"])
    expect(await run("unlock", FILE, "R1")).toBe(0)
    expect((await sidecar()).locks.map((l) => l.part)).toEqual(["C1"])
  })

  test("mark adds a positioned note and unmark removes it", async () => {
    expect(await run("mark", FILE, "route GND here", "--pcb", "10,5")).toBe(0)
    expect((await sidecar()).marks[0]).toMatchObject({ id: "m1", view: "pcb", x: 10, y: 5 })
    expect(await run("unmark", FILE, "m1")).toBe(0)
    expect((await sidecar()).marks).toEqual([])
  })

  test("summary, history and help print text", async () => {
    expect(await run("summary", FILE)).toBe(0)
    expect(out.join("\n")).toContain("R1 <resistor>")
    expect(await run("history")).toBe(0)
    expect(out.join("\n")).toContain("No changes recorded yet.")
    expect(await run("help")).toBe(0)
    expect(out.join("\n")).toContain("copperflow mcp")
  })

  test("errors are reported with a non-zero exit code", async () => {
    expect(await run("lock", FILE, "NOPE")).toBe(1)
    expect(err.join("\n")).toContain("NOPE")
    expect(await run("mark", FILE, "x", "--pcb", "ten,5")).toBe(1)
    expect(await run("undo")).toBe(1)
    expect(await run("frobnicate")).toBe(1)
    expect(err.join("\n")).toContain("Unknown command")
  })
})
