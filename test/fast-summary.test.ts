import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import { fastLineBlock, formatCopperSummary } from "../src/mcp/copper-summary.js"

const RULES = "netClasses:\n  can:\n    nets: [CANH, CANL]\n    pair: by-name\n    differentialImpedance: 120\n    gap: 0.2\n    maxSkew: 2\n"

test("copper_summary carries the fast-line block when the board has such classes", async () => {
  const root = fileURLToPath(new URL("../examples/can-node", import.meta.url))
  const files = { ...(await collectProjectFiles(root, { include: ENGINE_FILES })), "rules.yaml": RULES }
  const design = buildDesign(files, "can-node.circuit.tsx")
  const block = fastLineBlock(design)
  expect(block[0]).toBe("Fast lines (estimates; the router does not route pairs together or tune lengths):")
  expect(block[1]).toMatch(/^Pair CANH and CANL \(can\): [\d.]+ and [\d.]+ mm, skew [\d.]+ mm, side by side \d+ %, vias 1 and 1$/)
  expect(block[2]).toMatch(/^Class can: [\d.]+ mm width at a 0\.2 mm gap \(from 120 ohm differential at a 0\.2 mm gap\) gives 120\.0 ohm differential on a 1\.6 mm board, er 4\.6$/)
  expect(formatCopperSummary("can-node.circuit.tsx", design)).toContain(block.join("\n"))
  expect(design.lines?.map((row) => [row.net, row.partner])).toEqual([["net.CANH", "net.CANL"], ["net.CANL", "net.CANH"]])
}, 60_000)
