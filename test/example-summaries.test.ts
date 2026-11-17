import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import { formatCopperSummary } from "../src/mcp/copper-summary.js"

/** The examples have no pair, length or impedance classes: their copper summaries stay byte-equal to before. */
const EXAMPLES = [
  ["can-node", "can-node.circuit.tsx"],
  ["io-8", "io-8.circuit.tsx"],
  ["relay-driver", "relay-driver.circuit.tsx"],
  ["usb-c-ldo", "index.circuit.tsx"],
] as const

describe("example copper summaries", () => {
  for (const [name, file] of EXAMPLES) {
    test(`${name} is unchanged`, async () => {
      const root = fileURLToPath(new URL(`../examples/${name}`, import.meta.url))
      const design = buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), file)
      const text = formatCopperSummary(file, design)
      const fixture = new URL(`./fixtures/copper-summaries/${name}.txt`, import.meta.url)
      if (process.env.WRITE_SUMMARY_FIXTURES === "1") await writeFile(fixture, text)
      expect(design.lines).toBeUndefined()
      expect(text).toBe(await readFile(fixture, "utf8"))
    }, 60_000)
  }
})
