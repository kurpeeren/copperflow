import { describe, expect, test } from "vitest"
import type { Edit } from "../src/core/types.js"
import { buildDesign } from "../src/engine/design.js"
import { onPage, runPageCommand, type PageCommandInput } from "../studio/src/shell/page-commands.js"

const MAIN = "index.circuit.tsx"
const source = [
  "export default () => (",
  '  <board width="10mm" height="10mm">',
  '    <resistor name="R1" />',
  '    <page name="Power">',
  '      <capacitor name="C1" />',
  "    </page>",
  '    <page name="Spare">',
  "    </page>",
  "  </board>",
  ")",
  "",
].join("\n")
const design = buildDesign({ [MAIN]: source }, MAIN)

function input(page: string, answer: string | null = null) {
  const sent: { edits: Edit[]; summary: string }[] = []
  const notes: string[] = []
  const opened: string[] = []
  const given: PageCommandInput = {
    design,
    page,
    edit: async (edits, summary) => {
      sent.push({ edits, summary })
      return true
    },
    notify: (text) => notes.push(text),
    ask: () => answer,
    openPage: (name) => opened.push(name),
  }
  return { given, sent, notes, opened }
}

describe("the Page commands", () => {
  test("Add page asks for a name and opens the new page", async () => {
    const run = input("Main", " Sensors ")
    await runPageCommand("addPage", run.given)
    expect(run.sent).toEqual([{ edits: [{ kind: "addPage", name: "Sensors" }], summary: "add page Sensors" }])
    expect(run.opened).toEqual(["Sensors"])
  })

  test("a cancelled prompt sends nothing", async () => {
    const run = input("Power", null)
    await runPageCommand("addPage", run.given)
    await runPageCommand("renamePage", run.given)
    expect(run.sent).toEqual([])
  })

  test("Rename page renames the open page and follows it", async () => {
    const run = input("Power", "Supply")
    await runPageCommand("renamePage", run.given)
    expect(run.sent[0]?.edits).toEqual([{ kind: "renamePage", from: "Power", to: "Supply" }])
    expect(run.opened).toEqual(["Supply"])
  })

  test("Delete page is refused while the page has parts, and for Main", async () => {
    const power = input("Power")
    await runPageCommand("deletePage", power.given)
    const main = input("Main", "X")
    await runPageCommand("renamePage", main.given)
    await runPageCommand("deletePage", main.given)
    expect([...power.sent, ...main.sent]).toEqual([])
    expect(power.notes[0]).toMatch(/still has parts \(C1\)/)
    expect(main.notes).toHaveLength(2)
  })

  test("Delete page removes an empty page and opens the one before it", async () => {
    const run = input("Spare")
    await runPageCommand("deletePage", run.given)
    expect(run.sent[0]?.edits).toEqual([{ kind: "removePage", name: "Spare" }])
    expect(run.opened).toEqual(["Power"])
  })
})

describe("edits sent from a page", () => {
  test("what is added goes on the open page; other edits and Main are left alone", () => {
    const edits: Edit[] = [
      { kind: "addPart", tag: "resistor", name: "R9" },
      { kind: "addDrawing", tag: "schematictext", props: { text: "x" } },
      { kind: "addTrace", from: "R9.pin1", to: "net.GND" },
      { kind: "setProps", part: "R9", props: { schX: 1 } },
    ]
    expect(onPage(edits, "Power").map((e) => ("page" in e ? e.page : undefined))).toEqual(["Power", "Power", "Power", undefined])
    expect(onPage(edits, "Main")).toEqual(edits)
  })
})
