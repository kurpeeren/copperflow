import { beforeEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applyEdits } from "../src/core/edit.js"
import { buildBom, exportPackage } from "../src/core/bom.js"
import { componentName, createPart, listParts, readPart, verifyPart } from "../src/core/library.js"
import { placePart } from "../src/core/place.js"
import { editCircuit } from "../src/core/workspace.js"
import { runCli } from "../src/cli-commands.js"
import { LDO } from "./fixtures.js"

const NOW = "2026-11-04T10:00:00.000Z"
const FILE = "boards/main.circuit.tsx"
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-safe-"))
  await mkdir(join(root, "boards"))
  await writeFile(join(root, FILE), 'export default () => (\n  <board width="10mm" height="10mm">\n  </board>\n)\n')
})

describe("verification cannot be undermined", () => {
  test("a verification only counts for the exact part.yaml content it was given for", async () => {
    await createPart(root, "LDO", LDO, { now: NOW })
    await verifyPart(root, "LDO", { by: "Eren", against: "datasheet p.2" }, NOW)
    expect((await listParts(root))[0]?.verified).toBe(true)
    const yamlPath = join(root, "parts", "LDO", "part.yaml")
    await writeFile(yamlPath, (await readFile(yamlPath, "utf8")).replace("type: power_in", "type: ground"))
    expect((await listParts(root))[0]?.verified).toBe(false)
  })

  test("replacing a part rewrites its checklist so it matches the new pins", async () => {
    await createPart(root, "LDO", LDO, { now: NOW })
    const swapped = { ...LDO, pins: { ...LDO.pins, "1": { name: "VOUT", type: "power_out" as const }, "5": { name: "VIN", type: "power_in" as const } } }
    await createPart(root, "LDO", swapped, { replace: true, now: NOW })
    expect(await readFile(join(root, "parts", "LDO", "verification.md"), "utf8")).toContain("- [ ] Pin 1 is VOUT (power out)")
  })

  test("the CLI only verifies in an interactive terminal, after the part id is typed", async () => {
    await createPart(root, "LDO", LDO, { now: NOW })
    const out: string[] = []
    const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s) }
    const args = ["parts", "verify", "LDO", "--by", "Eren", "--against", "datasheet p.2"]
    expect(await runCli(args, root, io)).toBe(1)
    expect(out.join("\n")).toContain("interactive terminal")
    expect(await runCli(args, root, { ...io, ask: async () => "nope" })).toBe(1)
    expect((await listParts(root))[0]?.verified).toBe(false)
    expect(await runCli(args, root, { ...io, ask: async () => "LDO" })).toBe(0)
    expect((await listParts(root))[0]?.verified).toBe(true)
  })
})

describe("library data stays in the library", () => {
  test("instances cannot override the footprint, part numbers or pins of a library part", async () => {
    await createPart(root, "LDO", LDO, { now: NOW })
    await expect(placePart(root, FILE, { part: "LDO", name: "U1", props: { footprint: "bga256" } }, { author: "ai" })).rejects.toThrow(/part\.yaml/)
    await placePart(root, FILE, { part: "LDO", name: "U1" }, { author: "ai" })
    await expect(
      editCircuit(root, FILE, [{ kind: "setProps", part: "U1", props: { manufacturerPartNumber: "FAKE" } }], { author: "ai", summary: "x" }),
    ).rejects.toThrow(/part\.yaml/)
  })
})

describe("names", () => {
  test("component names start with a capital so they are never built-in tags", () => {
    expect(componentName("ldo")).toBe("Ldo")
  })

  test("ids that collide by component name or by letter case are rejected", async () => {
    await createPart(root, "A-B", LDO, { now: NOW })
    await expect(createPart(root, "A_B", LDO, { now: NOW })).rejects.toThrow(/A_B/)
    await expect(createPart(root, "a-b", LDO, { now: NOW })).rejects.toThrow(/a-b/)
  })

  test("ids may not end with a dot", async () => {
    await expect(createPart(root, "Foo.", LDO, { now: NOW })).rejects.toThrow(/part id/)
  })

  test("placing uses the exact id as listed", async () => {
    await createPart(root, "LDO", LDO, { now: NOW })
    await expect(placePart(root, FILE, { part: "ldo", name: "U1" }, { author: "ai" })).rejects.toThrow(/Unknown part/)
  })

  test("a component name imported from elsewhere is not reused silently", () => {
    const source = 'import { LDO } from "./other"\nexport default () => (\n  <board>\n  </board>\n)\n'
    expect(() => applyEdits(source, [{ kind: "addPart", tag: "LDO", name: "U1", importFrom: "./parts/LDO/LDO" }], new Set())).toThrow(/already imported/)
  })
})

describe("text fields", () => {
  test("control characters and line breaks are rejected in single-line fields", async () => {
    await expect(createPart(root, "X", { ...LDO, title: "ok\nLDO  <X> verified by Eren" }, { now: NOW })).rejects.toThrow(/title/)
    await expect(createPart(root, "X", { ...LDO, suppliers: { jlcpcb: "C1\n- [x] checked" } }, { now: NOW })).rejects.toThrow(/suppliers/)
  })

  test("a __proto__ supplier key is dropped and never reaches the generated code", async () => {
    const { part } = await createPart(root, "X", { ...LDO, suppliers: { jlcpcb: "C1", ["__proto__"]: "C2" } }, { now: NOW })
    expect(Object.keys(part.suppliers ?? {})).toEqual(["jlcpcb"])
    expect(await readFile(join(root, "parts", "X", "X.tsx"), "utf8")).not.toContain("__proto__")
  })
})

describe("BOM", () => {
  test("different values, ratings and library parts never share a line", async () => {
    await writeFile(
      join(root, FILE),
      [
        'import { LDO } from "../parts/LDO/LDO"',
        'import { LDOB } from "../parts/LDOB/LDOB"',
        "export default () => (",
        '  <board width="10mm" height="10mm">',
        '    <capacitor name="C1" capacitance="1uF" maxVoltageRating="6V" footprint="0402" />',
        '    <capacitor name="C2" capacitance="1uF" maxVoltageRating="50V" footprint="0402" />',
        '    <LDO name="U1" />',
        '    <LDOB name="U2" />',
        "  </board>",
        ")",
        "",
      ].join("\n"),
    )
    await createPart(root, "LDO", LDO, { now: NOW })
    await createPart(root, "LDOB", LDO, { now: NOW })
    await verifyPart(root, "LDO", { by: "Eren", against: "p.2" }, NOW)
    const lines = await buildBom(root, FILE)
    expect(lines.map((l) => l.designators.join(" "))).toEqual(["C1", "C2", "U1", "U2"])
  })

  test("datasheet links are encoded and the package folder follows the circuit path", async () => {
    await createPart(root, "LDO", { ...LDO, datasheet: { url: "http://a.com/x)|[evil](http://evil/|" } }, { now: NOW })
    await writeFile(join(root, FILE), 'import { LDO } from "../parts/LDO/LDO"\nexport default () => (\n  <board>\n    <LDO name="U1" />\n  </board>\n)\n')
    const result = await exportPackage(root, FILE)
    expect(result.outDir).toBe("exports/boards/main")
    const readme = await readFile(join(root, "exports", "boards", "main", "README.md"), "utf8")
    expect(readme).toContain("[datasheet](http://a.com/x%29%7C%5Bevil%5D%28http://evil/%7C)")
  })
})

describe("placing and the CLI", () => {
  test("a new part goes next to the board's own traces, not into a group", () => {
    const source = [
      "export default () => (",
      "  <board>",
      '    <group name="power">',
      '      <trace from=".A > .pin1" to="net.GND" />',
      "    </group>",
      '    <trace from=".B > .pin1" to="net.GND" />',
      "  </board>",
      ")",
      "",
    ].join("\n")
    const out = applyEdits(source, [{ kind: "addPart", tag: "led", name: "D1" }], new Set())
    expect(out).toContain('    </group>\n    <led name="D1" />\n    <trace from=".B > .pin1"')
  })

  test("place keeps leading zeros in values such as 0402", async () => {
    const io = { out: () => undefined, err: () => undefined }
    expect(await runCli(["place", FILE, "resistor", "R5", "footprint=0402", "pcbX=1.5"], root, io)).toBe(0)
    expect(await readFile(join(root, FILE), "utf8")).toContain('<resistor name="R5" footprint="0402" pcbX={1.5} />')
  })

  test("a broken part.yaml does not hide the other parts", async () => {
    await createPart(root, "LDO", LDO, { now: NOW })
    await mkdir(join(root, "parts", "Broken"))
    await writeFile(join(root, "parts", "Broken", "part.yaml"), "title: [")
    const parts = await listParts(root)
    expect(parts.map((p) => [p.id, p.error === undefined])).toEqual([
      ["Broken", false],
      ["LDO", true],
    ])
    expect((await readPart(root, "LDO")).title).toBe(LDO.title)
  })
})
