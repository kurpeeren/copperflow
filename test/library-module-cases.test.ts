import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "vitest"
import { libraryModels } from "../src/core/simulate.js"
import { readCard } from "../src/core/sheet-card.js"
import { checkPlainSheet } from "../src/core/plain-sheet.js"
import { runCases } from "../src/engine/sim/cases.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

// Every case of every module in library/modules runs on every test run: a module that stops doing what its card says
// fails here. A module is built from its own folder, its parts as the library holds them.
const MODULES = join(import.meta.dirname, "..", "library", "modules")

const names = (await readdir(MODULES)).sort()

/**
 * Cases that show a module not doing what its card says, as found: kept as written, not bent to pass, and listed
 * here so the suite stays a check of everything else. A finding that changes, or a new miss, fails the test.
 */
const FINDINGS: Readonly<Record<string, string>> = {}

test("the library has modules with cases", async () => {
  expect(names.length).toBeGreaterThan(0)
  for (const name of names) {
    const text = await readFile(join(MODULES, name, `${name}.sheet.tsx`), "utf8")
    expect(checkPlainSheet(text).name, name).toBe(name)
    expect(readCard(text).cases?.length ?? 0, `${name} has no cases`).toBeGreaterThan(0)
  }
})

test.each(names)("every case of %s passes, or misses as recorded in FINDINGS", async (name) => {
  const root = join(MODULES, name)
  const file = `${name}.sheet.tsx`
  const design = await inProcessEngine.build(root, file)
  expect(design.diagnostics.filter((d) => d.severity === "error")).toEqual([])
  const cases = readCard(await readFile(join(root, file), "utf8")).cases ?? []
  const lines = runCases(design.circuit, await libraryModels(root, design.circuit), cases)
  expect(lines.map((line) => line.text)).toEqual(cases.map((one) => FINDINGS[`${name}/${one.name}`] ?? `passed: ${one.name}`))
})
