import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { contentHash, createPart, PartSchema, verificationTemplate, type Part } from "../src/core/library.js"
import { checklistItems } from "../src/core/checklist-text.js"

const mosfet = (vth = 1.45): Part =>
  PartSchema.parse({
    title: "AO3400A",
    footprint: "sot23",
    pins: { "1": { name: "G", type: "input" }, "2": { name: "S", type: "passive" }, "3": { name: "D", type: "passive" } },
    model: {
      kind: "nmos",
      pins: { gate: "G", source: "S", drain: "D" },
      figures: {
        vth: { value: vth, source: "p2, Electrical Characteristics" },
        rdson: { value: 0.048, source: "p2, Electrical Characteristics" },
        rdsonAt: { value: 2.5, source: "p2, Electrical Characteristics" },
      },
    },
  })

const issues = (data: unknown) => {
  const parsed = PartSchema.safeParse(data)
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)
}

test("a part's model is read with its figures and their pages", () => {
  expect(mosfet().model?.figures?.["vth"]).toEqual({ value: 1.45, source: "p2, Electrical Characteristics" })
})

test("the model refuses unknown keys, unknown figures, missing figures and figures out of range", () => {
  const base = { title: "x", footprint: "sot23", pins: { "1": { name: "G", type: "input" }, "2": { name: "S", type: "passive" }, "3": { name: "D", type: "passive" } } }
  const pins = { gate: "G", source: "S", drain: "D" }
  const fig = (value: number) => ({ value, source: "p2" })
  expect(issues({ ...base, model: { kind: "nmos", pins, figures: { vth: fig(1), rdson: fig(0.05), rdsonAt: fig(2.5) }, extra: 1 } }).join()).toMatch(/extra/)
  expect(issues({ ...base, model: { kind: "nmos", pins, figures: { vth: fig(1), rdson: fig(0.05), rdsonAt: fig(2.5), hfe: fig(100) } } }).join()).toMatch(/takes no figure hfe/)
  expect(issues({ ...base, model: { kind: "nmos", pins, figures: { vth: fig(1), rdson: fig(0.05) } } }).join()).toMatch(/needs figure rdsonAt/)
  expect(issues({ ...base, model: { kind: "nmos", pins, figures: { vth: fig(50), rdson: fig(0.05), rdsonAt: fig(2.5) } } }).join()).toMatch(/vth .* must be 100 mV to 10.0 V/)
  expect(issues({ ...base, model: { kind: "nmos", pins: { gate: "G", source: "S", drain: "X" }, figures: { vth: fig(1), rdson: fig(0.05), rdsonAt: fig(2.5) } } }).join()).toMatch(/no pin X/)
  expect(issues({ ...base, model: { kind: "transistor" } }).join()).toMatch(/Invalid option/)
  expect(issues({ ...base, model: { kind: "nmos", pins, figures: { vth: { value: 1 }, rdson: fig(0.05), rdsonAt: fig(2.5) } } })).not.toEqual([])
})

test("a chip's model may say what its pins draw", () => {
  const chip = { title: "x", footprint: "sot23", pins: { "1": { name: "VDD", type: "power_in" } }, model: { kind: "chip", loads: { VDD: 0.005 } } }
  expect(issues(chip)).toEqual([])
  expect(issues({ ...chip, model: { kind: "chip", loads: { VCC: 0.005 } } }).join()).toMatch(/no pin VCC/)
})

test("the checklist gains one item a figure, with its page", () => {
  const items = checklistItems(verificationTemplate("AO3400A", mosfet())).map((item) => item.text)
  expect(items).toContain("Model nmos pins: gate G, source S, drain D")
  expect(items).toContain("Model vth 1.45 V, p2, Electrical Characteristics: compare")
  expect(items).toContain("Model rdson 48.0 mΩ, p2, Electrical Characteristics: compare")
  expect(items).toContain("Model rdsonAt 2.50 V, p2, Electrical Characteristics: compare")
})

test("changing a model figure changes the content hash, so it voids a verification", () => {
  expect(contentHash(mosfet(1.45))).not.toBe(contentHash(mosfet(1.5)))
  const { model: _model, ...without } = mosfet()
  expect(contentHash(without)).not.toBe(contentHash(mosfet()))
})

test("create_part's core writes the model and its checklist items", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-model-"))
  await createPart(root, "AO3400A", mosfet(), { now: "2026-11-17" })
  expect(await readFile(join(root, "parts", "AO3400A", "part.yaml"), "utf8")).toMatch(/model:\n {2}kind: nmos/)
  expect(await readFile(join(root, "parts", "AO3400A", "verification.md"), "utf8")).toMatch(/- \[ \] Model vth 1.45 V, p2/)
})
