// The Verify screen as the person sees it, rendered as the Studio's other dialogs are tested: the footprint with its
// figures, the pin rows with their ticks, the datasheet at its page, the mark form, and the read-only look again.
import { createElement, type FunctionComponent } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { generateFootprint } from "../src/engine/footprints/index.js"
import type { Footprint } from "../src/engine/footprints/types.js"
import type { PartDetails } from "../studio/src/api.js"

// The components are .tsx: the test runner loads them, the root type check (no JSX there) does not follow these paths.
const DIALOG = "../studio/src/shell/VerifyPartDialog.js"
const TABLE = "../studio/src/LibraryTable.js"
const { VerifyScreen } = (await import(DIALOG)) as { VerifyScreen: FunctionComponent<any> }
const { LibraryTable } = (await import(TABLE)) as { LibraryTable: FunctionComponent<any> }

interface VerifyPanel {
  load(id: string): Promise<PartDetails>
  tick(): Promise<{ checklist: string }>
  mark(): Promise<void>
  frame(): Promise<string>
  release(): void
  print(): boolean
}

function footprint(name: string): Footprint {
  const made = generateFootprint(name)
  if ("error" in made) throw new Error(made.error)
  return made
}

const HASH = "5cff0330a85f".padEnd(64, "0")
const CHECKLIST = [
  "# Verification of Regulator",
  "",
  "Content: 5cff0330a85f (changes when part.yaml changes)",
  "",
  "- [ ] Pins from Regulator datasheet rev B, page(s) 3-4: compare each pin",
  "- [x] Pin 1 is VIN (power in)",
  "- [ ] Pin 2 is GND (ground)",
  "- [ ] Pin 3 is VOUT (power out)",
  "- [ ] Footprint sot23 matches the package drawing",
  "",
].join("\n")

const DETAILS: PartDetails = {
  id: "U1",
  part: {
    title: "Regulator",
    footprint: "sot23",
    pins: { "1": { name: "VIN", type: "power_in" }, "2": { name: "GND", type: "ground" }, "3": { name: "VOUT", type: "power_out" } },
    datasheet: { url: "https://example.com/reg.pdf", title: "Regulator datasheet rev B" },
    datasheet_pages: "3-4",
  },
  checklist: CHECKLIST,
  hash: HASH,
  verified: false,
  footprint: footprint("sot23"),
}

const PANEL: VerifyPanel = {
  load: async () => DETAILS,
  tick: async () => ({ checklist: CHECKLIST }),
  mark: async () => undefined,
  frame: async () => "blob:x",
  release: () => undefined,
  print: () => true,
}

const render = (details: PartDetails, checklist = details.checklist) =>
  renderToStaticMarkup(createElement(VerifyScreen, { details, checklist, panel: PANEL, busy: false, onTick: () => undefined, onMark: () => undefined, onProblem: () => undefined }))

describe("the Verify screen", () => {
  test("three areas: the footprint with its figures, the pins and checklist, the datasheet", () => {
    const html = render(DETAILS)
    expect(html).toContain('aria-label="Footprint"')
    expect(html).toContain('aria-label="Pins and checklist"')
    expect(html).toContain('aria-label="Datasheet"')
    expect(html).toContain("<th scope=\"row\">Pitch along</th><td>1.9 mm</td>")
    expect(html).toContain('aria-label="Pad 1, VIN: x -0.95 mm, y -1.125 mm, 0.6 × 0.95 mm"')
    expect(html).toContain(">Print at 1:1</button>")
  })

  test("pin rows: the tick, and power and ground said in a word", () => {
    const html = render(DETAILS)
    expect(html).toMatch(/<input type="checkbox" aria-label="Pin 1 VIN matches the datasheet" checked=""/)
    expect(html).toContain(">Power</span>")
    expect(html).toContain(">Ground</span>")
    expect(html).toContain("Footprint sot23 matches the package drawing")
    expect(html).toContain(">Tick all pins…</button>")
    expect(html).toContain("1 of 5 items ticked")
  })

  test("the datasheet opens in a new tab at its first page, and Checked against starts from it", () => {
    const html = render(DETAILS)
    expect(html).toContain('href="https://example.com/reg.pdf#page=3" target="_blank" rel="noreferrer noopener">Open the datasheet</a>')
    expect(html).toContain('value="Regulator datasheet rev B, page(s) 3-4"')
  })

  test("Mark verified stays off until every item is ticked and the form is filled, and says what is missing", () => {
    const html = render(DETAILS)
    expect(html).toMatch(/<button type="submit" class="primary" disabled="" aria-describedby="([^"]+)">Mark verified<\/button><p id="\1" class="verify-missing-line">Still missing: 4 items open; your name; type the id.<\/p>/)
  })

  test("Tick all pins is off when every pin is ticked", () => {
    const pinsDone = CHECKLIST.replace("- [ ] Pin 2", "- [x] Pin 2").replace("- [ ] Pin 3", "- [x] Pin 3")
    expect(render(DETAILS, pinsDone)).toMatch(/<button type="button" disabled="">Tick all pins…<\/button>/)
  })

  test("a part with no datasheet says so and what to do", () => {
    const html = render({ ...DETAILS, part: { ...DETAILS.part, datasheet: undefined, datasheet_pages: undefined } })
    expect(html).toContain("This part records no datasheet. Ask the agent to attach it (set_part_fields { datasheet }), or add it to part.yaml")
  })

  test("a placeholder footprint is drawn with the reason, and marking stays off", () => {
    const placeholder = 'Part U1 cannot be verified: parts/U1/footprint.yaml is a placeholder; draw its pads from the datasheet\'s land pattern, then delete "placeholder: true"'
    const html = render({ ...DETAILS, placeholder, checklist: CHECKLIST.replace(/- \[ \]/g, "- [x]") })
    expect(html).toContain(placeholder.replace(/'/g, "&#x27;").replace(/"/g, "&quot;"))
    expect(html).toMatch(/disabled="" aria-describedby="[^"]+">Mark verified/)
  })

  test("ticks made before the part changed: the screen says so and shows them open", () => {
    const html = render({ ...DETAILS, hash: "f".repeat(64) })
    expect(html).toContain("The part changed since these items were ticked")
    expect(html).not.toMatch(/checked=""/)
  })

  test("a verified part: who and against what, read-only, nothing to mark", () => {
    const html = render({ ...DETAILS, verified: true, part: { ...DETAILS.part, verified: { by: "Eren", against: "Regulator datasheet rev B, page 3", date: "2026-11-17T10:00:00.000Z" } } })
    expect(html).toContain("Verified by Eren against Regulator datasheet rev B, page 3 on 2026-11-17.")
    expect(html).not.toContain("Mark verified")
    expect(html).not.toContain("Tick all pins")
    expect(html).toMatch(/aria-label="Pin 2 GND matches the datasheet" disabled=""/)
  })
})

describe("the Library table opens the screen", () => {
  test("Verify… on a part not verified, Look again on a verified one, both named", () => {
    const parts = {
      library: [
        { id: "U1", title: "Regulator", footprint: "sot23", component: "U1", verified: false },
        { id: "U2", title: "Driver", footprint: "soic8", component: "U2", verified: true, verifiedBy: "Eren", verifiedAgainst: "Driver datasheet p. 2" },
      ],
      builtin: [],
    }
    const html = renderToStaticMarkup(createElement(LibraryTable, { parts, onPlace: () => undefined, onVerify: () => undefined }))
    expect(html).toContain('aria-label="Verify Regulator">Verify…</button>')
    expect(html).toContain('aria-label="Look again at Driver">Look again</button>')
    expect(html).toContain('title="Checked by Eren against Driver datasheet p. 2"')
  })
})
