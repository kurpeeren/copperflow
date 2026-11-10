import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { redoChange, undoChange } from "../src/core/workspace.js"
import { setFilletRadius, withFilletRadius } from "../src/core/rules-edit.js"
import { loadRules } from "../src/engine/rules/load.js"
import { filletRadius } from "../src/engine/rules/track-defaults.js"

const radiusIn = (text: string) => filletRadius(loadRules({ "rules.yaml": text }).rules)

describe("withFilletRadius", () => {
  test("writes the radius under fabrication, keeping the rest of the file and its comments", () => {
    const before = "# our board house\nfabrication:\n  profile: jlcpcb-2layer # cheapest\n  minClearance: 6mil\nglobalNets: [GND]\n"
    const after = withFilletRadius(before, 1.5)
    expect(after).toContain("# our board house")
    expect(after).toContain("profile: jlcpcb-2layer # cheapest")
    expect(after).toContain("minClearance: 6mil")
    expect(after).toContain("globalNets: [GND]")
    expect(radiusIn(after)).toBe(1.5)
    expect(loadRules({ "rules.yaml": after }).diagnostics).toEqual([])
  })

  test("starts a file or a fabrication section when there is none, and changes a radius already there", () => {
    expect(withFilletRadius("", 2)).toBe("fabrication:\n  filletRadius: 2\n")
    expect(radiusIn(withFilletRadius("globalNets: [GND]\n", 0.8))).toBe(0.8)
    expect(radiusIn(withFilletRadius("fabrication:\n  filletRadius: 3mm\n", 0.5))).toBe(0.5)
  })

  test("without a radius goes back to the default, dropping a fabrication section left empty", () => {
    expect(withFilletRadius("fabrication:\n  filletRadius: 2\n", undefined)).toBe("")
    const kept = withFilletRadius("fabrication:\n  profile: jlcpcb-4layer\n  filletRadius: 2\n", undefined)
    expect(kept).toBe("fabrication:\n  profile: jlcpcb-4layer\n")
    expect(radiusIn(kept)).toBe(1)
  })

  test("refuses a file that is not valid YAML, and a radius that is no positive length", () => {
    expect(() => withFilletRadius("fabrication: [\n", 1)).toThrow(/rules\.yaml/)
    for (const bad of [0, -1, Number.NaN, 51]) expect(() => withFilletRadius("", bad)).toThrow(/radius/)
  })
})

describe("setFilletRadius", () => {
  test("writes rules.yaml as one history entry that undo and redo take back and forth", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-rules-"))
    await writeFile(join(root, "rules.yaml"), "globalNets: [GND]\n")
    const entry = await setFilletRadius(root, 1.5, { author: "human" })
    expect(entry).toMatchObject({ file: "rules.yaml", summary: "Set the fillet radius to 1.5 mm", author: "human" })
    expect(radiusIn(await readFile(join(root, "rules.yaml"), "utf8"))).toBe(1.5)
    await undoChange(root, { author: "human" })
    expect(await readFile(join(root, "rules.yaml"), "utf8")).toBe("globalNets: [GND]\n")
    await redoChange(root, { author: "human" })
    expect(radiusIn(await readFile(join(root, "rules.yaml"), "utf8"))).toBe(1.5)
    const back = await setFilletRadius(root, undefined, { author: "human" })
    expect(back.summary).toBe("Set the fillet radius back to the default, 1 mm")
  })

  test("creates rules.yaml when the project has none; undo removes it again", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-rules-"))
    await setFilletRadius(root, 2, { author: "human" })
    expect(await readFile(join(root, "rules.yaml"), "utf8")).toBe("fabrication:\n  filletRadius: 2\n")
    await undoChange(root, { author: "human" })
    expect(existsSync(join(root, "rules.yaml"))).toBe(false)
  })

  test("refuses a change that changes nothing", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-rules-"))
    await expect(setFilletRadius(root, undefined, { author: "human" })).rejects.toThrow(/no change/)
  })
})
