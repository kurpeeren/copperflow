import { beforeEach, describe, expect, test } from "vitest"
import { cp, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { checkCircuit, formatCheck, type CheckResult } from "../src/core/check.js"
import type { Violation } from "../src/engine/index.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const FILE = "main.circuit.tsx"
const EXAMPLE = fileURLToPath(new URL("../examples/usb-c-ldo", import.meta.url))
let root: string

const placed = "pcbX={0} pcbY={0} schX={0} schY={0}"
const board = (body: string) => `export default () => (\n  <board width="20mm" height="20mm">\n${body}\n  </board>\n)\n`
const FLOATING_EN = board(
  [
    `    <chip name="U1" footprint="soic8" pinLabels={{ pin1: "GND", pin2: "VIN", pin3: "EN", pin4: "GND" }} pinAttributes={{ EN: { isInput: true } }} ${placed} />`,
    '    <trace from="U1.pin1" to="net.GND" />',
    '    <trace from="U1.pin2" to="net.VIN" />',
  ].join("\n"),
)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-check-"))
  await writeFile(join(root, FILE), board(""))
})

async function checkExample(): Promise<CheckResult> {
  await cp(EXAMPLE, root, { recursive: true })
  return checkCircuit(root, "index.circuit.tsx", { engine: inProcessEngine })
}

async function checkFloating(): Promise<CheckResult> {
  await writeFile(join(root, FILE), FLOATING_EN)
  return checkCircuit(root, FILE, { engine: inProcessEngine })
}

describe("checkCircuit", () => {
  test("the example passes and warns that connections are unrouted", async () => {
    const result = await checkExample()
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings.map((g) => g.type)).toContain("unrouted")
  })

  test("a floating EN pin fails the check with a pin-unconnected group naming U1.pin3", async () => {
    const result = await checkFloating()
    expect(result.ok).toBe(false)
    const group = result.errors.find((g) => g.type === "pin-unconnected")
    expect(group?.messages.join("\n")).toContain("U1.pin3")
    expect(result.violations.some((v) => v.code === "pin-unconnected" && v.items.includes("U1.pin3"))).toBe(true)
  })

  test("an error diagnostic fails the check under its own code, with its source position", async () => {
    await writeFile(join(root, FILE), board(`    <led name="D1" footprint="bga64" ${placed} />`))
    const result = await checkCircuit(root, FILE, { engine: inProcessEngine })
    expect(result.ok).toBe(false)
    expect(result.diagnostics.some((d) => d.code === "footprint")).toBe(true)
    expect(result.errors.map((g) => g.type)).toContain("footprint")
    expect(formatCheck(FILE, result)).toMatch(/main\.circuit\.tsx:\d+:\d+/)
  })

  test("circuit code the engine cannot run is reported with its file, line and column", async () => {
    await writeFile(join(root, FILE), "export default () => <board>\n")
    await expect(checkCircuit(root, FILE, { engine: inProcessEngine })).rejects.toThrow(/main\.circuit\.tsx:\d+:\d+/)
  })

  test("only checks circuit files inside the project", async () => {
    await expect(checkCircuit(root, "../x.circuit.tsx", { engine: inProcessEngine })).rejects.toThrow(/outside the project/)
  })
})

const violation = (over: Partial<Violation>): Violation => ({
  id: "x:A",
  code: "x",
  severity: "error",
  message: "m",
  items: [],
  view: "pcb",
  ...over,
})

describe("formatCheck", () => {
  test("prints the positions of violations and the schematic as a place", async () => {
    const text = formatCheck(FILE, await checkFloating())
    expect(text.split("\n")[0]).toMatch(/^main\.circuit\.tsx: check failed, \d+ errors?, \d+ warnings?/)
    expect(text).toMatch(/U1\.pin3 \(EN\) is not connected at the schematic/)
    const unrouted = violation({ code: "unrouted", severity: "warning", message: "3 connections are not routed yet", at: { x: 1.5, y: -2.25 } })
    const engine = { build: async () => ({ violations: [unrouted], diagnostics: [] }) as never }
    const lines = formatCheck(FILE, await checkCircuit(root, FILE, { engine })).split("\n")
    expect(lines).toEqual([`${FILE}: check passed, 0 errors, 1 warning`, "Warnings:", "  unrouted:", "    3 connections are not routed yet at 1.50, -2.25 mm"])
  })

  test("shows at most three messages per group and counts the rest", async () => {
    const text = formatCheck(FILE, await checkCircuit(root, FILE, { engine: manyViolations(5) }))
    const lines = text.split("\n")
    expect(lines).toContain("  x (5):")
    expect(lines.filter((l) => /^ {4}m\d/.test(l))).toHaveLength(3)
    expect(lines).toContain("    … and 2 more")
  })

  test("a diagnostic without a position prints none", async () => {
    const engine = { build: async () => ({ violations: [], diagnostics: [{ code: "d", severity: "warning", message: "plain", items: [] }] }) as never }
    const text = formatCheck(FILE, await checkCircuit(root, FILE, { engine }))
    expect(text).toContain("    plain")
    expect(text).not.toMatch(/plain at|plain \(/)
  })

  test("places a pcb violation at its point in millimetres", async () => {
    const at = { x: 12.3, y: 4.5 }
    const engine = { build: async () => ({ violations: [violation({ code: "overlap", message: "R1 overlaps R2", at })], diagnostics: [] }) as never }
    expect(formatCheck(FILE, await checkCircuit(root, FILE, { engine }))).toContain("R1 overlaps R2 at 12.30, 4.50 mm")
  })

  test("a long message is clipped before its position, so the position is kept", async () => {
    const long = "x".repeat(400)
    const source = { file: FILE, line: 3, column: 7, offset: 0 }
    const engine = {
      build: async () => ({ violations: [violation({ message: long, at: { x: 1.5, y: -2.25 } })], diagnostics: [{ code: "d", severity: "error", message: long, items: [], source }] }) as never,
    }
    const lines = formatCheck(FILE, await checkCircuit(root, FILE, { engine })).split("\n")
    expect(lines).toContain(`    ${"x".repeat(300)}… at 1.50, -2.25 mm`)
    expect(lines).toContain(`    ${"x".repeat(300)}… at main.circuit.tsx:3:7`)
  })
})

function manyViolations(n: number) {
  const violations = Array.from({ length: n }, (_, i) => violation({ code: "x", message: `m${i}`, id: `x:${i}`, items: [`P${i}`] }))
  return { build: async () => ({ violations, diagnostics: [] }) as never }
}

describe("no tscircuit left in the code", () => {
  /** Matching lines of `git grep -n`. No match (exit 1, nothing on stderr) is ""; anything else fails the test, so a missing git cannot pass it. */
  const git = (args: readonly string[]): string => {
    try {
      return execFileSync("git", ["grep", "-n", ...args], { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] })
    } catch (error) {
      const { status, stderr } = error as { status?: number | null; stderr?: string }
      if (status === 1 && !stderr) return ""
      throw new Error(`git grep could not search the repository, so this test cannot tell: ${(error as Error).message}`)
    }
  }
  const word = ["ts", "ci"].join("")

  test("only the --tsci rejection in the CLI names the old command", () => {
    const hits = git(["-w", word, "--", "src"]).split("\n").filter(Boolean)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatch(/^src\/cli-commands\.ts:\d+:/)
    expect(hits[0]).toContain(`--${word}`)
  })

  test("the old build hooks and the fake CLI are gone", () => {
    const names = [["COPPERFLOW", "TSCI"].join("_"), ["build", "Command"].join(""), ["build", "Circuit"].join(""), ["fake", "tsci"].join("-")]
    expect(git([...names.flatMap((n) => ["-e", n]), "--", "src", "test"])).toBe("")
  })
})
