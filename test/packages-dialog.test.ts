import { describe, expect, test } from "vitest"
import { PACKAGES, PACKAGE_GROUPS, PACKAGE_FORMS } from "../src/engine/footprints/catalogue.js"
import {
  buttonLabel,
  enterAction,
  enterOutcome,
  preselects,
  startOf,
  formsHint,
  inspectorEdit,
  keptSelection,
  managerChange,
  movedSelection,
  movesSelection,
  packageDetails,
  packageRows,
} from "../studio/src/shell/packages.js"
import { MENUS, menuItems } from "../studio/src/shell/menus.js"
import { commandOwner } from "../studio/src/shell/command-owners.js"
import { packagesRequests } from "../studio/src/shell/packages-request.js"

const extraEntry = PACKAGES.find((entry) => entry.extra === true)

describe("Packages: the rows", () => {
  test("no words and all groups lists every package, extras included, in catalogue order", () => {
    const rows = packageRows("", "all")
    expect(rows.map((row) => row.footprint)).toEqual(PACKAGES.map((entry) => entry.footprint))
  })

  test("a search finds by written name and by string", () => {
    expect(packageRows("SOT-23-5", "all").map((row) => row.footprint)).toContain("sot23_5")
    expect(packageRows("soic8", "all")[0]?.footprint).toBe("soic8")
    expect(packageRows("no such package", "all")).toEqual([])
  })

  test("a group narrows the rows to that group", () => {
    const rows = packageRows("", "Crystals and oscillators")
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.group === "Crystals and oscillators")).toBe(true)
    expect(packageRows("soic", "Diodes")).toEqual([])
  })

  test("a row carries name, string, pads, courtyard size and mount", () => {
    const [row] = packageRows("soic8", "ICs with leads")
    expect(row).toMatchObject({ footprint: "soic8", name: "SOIC-8, 3.9 mm", pads: 8, mount: "Surface-mount" })
    expect(row?.size).toMatch(/^\d+(\.\d)? × \d+(\.\d)? mm$/)
    expect(packageRows("dip8", "all").find((r) => r.footprint === "dip8")?.mount).toBe("Through-hole")
  })

  test("every group is offered", () => {
    for (const group of PACKAGE_GROUPS) expect(packageRows("", group).length).toBeGreaterThan(0)
  })
})

describe("Packages: the selection", () => {
  const rows = packageRows("", "Chip passives")
  const [first, second] = rows

  test("arrows move down and up and stop at the ends", () => {
    expect(movedSelection(rows, first?.footprint, "ArrowDown")).toBe(second?.footprint)
    expect(movedSelection(rows, second?.footprint, "ArrowUp")).toBe(first?.footprint)
    expect(movedSelection(rows, first?.footprint, "ArrowUp")).toBe(first?.footprint)
    expect(movedSelection(rows, rows.at(-1)?.footprint, "ArrowDown")).toBe(rows.at(-1)?.footprint)
    expect(movedSelection(rows, second?.footprint, "Home")).toBe(first?.footprint)
    expect(movedSelection(rows, first?.footprint, "End")).toBe(rows.at(-1)?.footprint)
  })

  test("with nothing selected, a key picks the first row; with no rows, nothing", () => {
    expect(movedSelection(rows, undefined, "ArrowDown")).toBe(first?.footprint)
    expect(movedSelection([], undefined, "ArrowDown")).toBeUndefined()
  })

  test("the selection stays when the row is still shown, and goes to the first row when not", () => {
    expect(keptSelection(rows, "0805")).toBe("0805")
    expect(keptSelection(packageRows("sot", "all"), "0805")).toBe(packageRows("sot", "all")[0]?.footprint)
    expect(keptSelection([], "0805")).toBeUndefined()
  })
})

describe("Packages: the facts", () => {
  test("soic8: 8 pads, surface-mount, a height from the table, an origin", () => {
    const facts = packageDetails("soic8")
    if ("error" in facts) throw new Error(facts.error)
    expect(facts).toMatchObject({ footprint: "soic8", pads: 8, mount: "Surface-mount" })
    expect(facts.height).toBeGreaterThan(1)
    expect(facts.heightNote).not.toMatch(/assumed/)
    expect(facts.origin.length).toBeGreaterThan(0)
  })

  test("dip8: through-hole, 8 pads", () => {
    const facts = packageDetails("dip8")
    if ("error" in facts) throw new Error(facts.error)
    expect(facts).toMatchObject({ pads: 8, mount: "Through-hole" })
  })

  test.runIf(extraEntry !== undefined)("an extra package has its facts too", () => {
    const facts = packageDetails(extraEntry?.footprint ?? "")
    expect("error" in facts).toBe(false)
  })

  test("a typed size the catalogue does not list is made", () => {
    const facts = packageDetails("tssop24")
    if ("error" in facts) throw new Error(facts.error)
    expect(facts.pads).toBe(24)
  })

  test("a string that cannot be made gives the generator's reason", () => {
    const facts = packageDetails("qfn32_5x6_p0.5")
    expect("error" in facts && facts.error).toMatch(/square/i)
    expect(packageDetails("")).toHaveProperty("error")
    expect(packageDetails("parts/ldo/footprint.yaml")).toHaveProperty("error")
  })

  test("the forms hint lists every form", () => {
    for (const form of PACKAGE_FORMS) expect(formsHint()).toContain(form.form)
  })
})

describe("Packages: what choosing does", () => {
  test("opened to look, it copies: no use button, Enter copies", () => {
    expect(buttonLabel({ kind: "look" })).toBeUndefined()
    expect(enterAction({ kind: "look" })).toBe("copy")
  })

  test("from the footprint manager, it writes the row's field", () => {
    const purpose = { kind: "manager", part: "R1" } as const
    expect(buttonLabel(purpose)).toBe("Use this footprint")
    expect(enterAction(purpose)).toBe("use")
    const before = { R2: "0603" }
    expect(managerChange(before, "R1", "0805")).toEqual({ R2: "0603", R1: "0805" })
    expect(before).toEqual({ R2: "0603" })
  })

  test("from the inspector, it is the edit typing the footprint makes", () => {
    expect(inspectorEdit("U1", "soic8")).toEqual({ edits: [{ kind: "setProps", part: "U1", props: { footprint: "soic8" } }], summary: 'set U1 footprint="soic8"' })
  })
})

describe("Packages: where it opens from", () => {
  test("Tools has Packages… next to the footprint manager, run by the app", () => {
    const tools = MENUS.find((menu) => menu.title === "Tools")
    const items = tools ? menuItems(tools) : []
    const at = items.findIndex((item) => item.command === "footprintManager")
    expect(items[at + 1]).toEqual({ label: "Packages…", command: "packages" })
    expect(commandOwner("packages")).toBe("app")
  })

  test("a request is shown until it is closed", () => {
    const seen: unknown[] = []
    const stop = packagesRequests.subscribe(() => seen.push(packagesRequests.current()))
    packagesRequests.open({ purpose: { kind: "look" } })
    expect(packagesRequests.current()).toEqual({ purpose: { kind: "look" } })
    packagesRequests.close()
    expect(packagesRequests.current()).toBeUndefined()
    stop()
    expect(seen).toHaveLength(2)
  })
})

describe("Packages: review fixes", () => {
  const rows = packageRows("", "Chip passives")

  test("opened to choose with nothing chosen, nothing is selected until a key or click", () => {
    expect(preselects({ kind: "look" })).toBe(true)
    expect(preselects({ kind: "inspector", part: "R1" })).toBe(false)
    expect(keptSelection(rows, undefined, false)).toBeUndefined()
    expect(keptSelection(rows, "0805", false)).toBe("0805")
    expect(keptSelection(packageRows("sot", "all"), "0805", false)).toBeUndefined()
    expect(movedSelection(rows, undefined, "ArrowDown")).toBe(rows[0]?.footprint)
  })

  test("the first string: a catalogue package is selected, another string typed, nothing empty", () => {
    expect(startOf("soic8")).toEqual({ selected: "soic8", typed: "" })
    expect(startOf("pinrow2_p2")).toEqual({ typed: "pinrow2_p2" })
    expect(startOf(undefined)).toEqual({ typed: "" })
  })

  test("Enter with a string that cannot be made does nothing when choosing, copies when looking", () => {
    expect(enterOutcome({ kind: "manager", part: "R1" }, false)).toBe("nothing")
    expect(enterOutcome({ kind: "manager", part: "R1" }, true)).toBe("use")
    expect(enterOutcome({ kind: "look" }, false)).toBe("copy")
    expect(enterOutcome({ kind: "look" }, true)).toBe("copy")
  })

  test("in a text field Home and End stay the caret's", () => {
    expect(movesSelection("ArrowDown", true)).toBe(true)
    expect(movesSelection("PageUp", true)).toBe(true)
    expect(movesSelection("Home", true)).toBe(false)
    expect(movesSelection("End", true)).toBe(false)
    expect(movesSelection("Home", false)).toBe(true)
  })
})
