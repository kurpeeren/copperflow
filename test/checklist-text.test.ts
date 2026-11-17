// verification.md as a list of ticks: the items are its "- [ ]" lines; ticking changes one character of a line and
// nothing else, and ticks count only for the content hash the file names.
import { describe, expect, test } from "vitest"
import { checklistContent, checklistItems, openItems, withoutTicks, withTicks } from "../src/core/checklist-text.js"

const HASH = "5cff0330a85f0123456789abcdef"
const FILE = [
  "# Verification of MCP2515",
  "",
  "Status: not verified",
  "Content: 5cff0330a85f (changes when part.yaml changes)",
  "",
  "- [ ] Pin 1 is TXCAN (output)",
  "- [x] Pin 2 is RXCAN (input)",
  "- [ ] Footprint soic18w matches the package drawing",
  "",
  "## Where each item was read",
  "",
  "- Page 1, Package Types: pins 1 to 18.",
  "",
].join("\n")

describe("the items of verification.md", () => {
  test("are its tick lines, in order, with their state; other list lines are not items", () => {
    expect(checklistItems(FILE)).toEqual([
      { text: "Pin 1 is TXCAN (output)", ticked: false },
      { text: "Pin 2 is RXCAN (input)", ticked: true },
      { text: "Footprint soic18w matches the package drawing", ticked: false },
    ])
    expect(checklistContent(FILE)).toBe("5cff0330a85f")
    expect(checklistContent("no content line")).toBeUndefined()
  })

  test("ticking changes the one character and keeps every other byte, CR included", () => {
    const ticked = withTicks(FILE, ["Pin 1 is TXCAN (output)"], true)
    expect(ticked).toEqual({ text: FILE.replace("- [ ] Pin 1", "- [x] Pin 1") })
    const crlf = FILE.replace(/\n/g, "\r\n")
    expect(withTicks(crlf, ["Footprint soic18w matches the package drawing"], true)).toEqual({ text: crlf.replace("- [ ] Footprint", "- [x] Footprint") })
    expect(withTicks(FILE, ["Pin 2 is RXCAN (input)"], false)).toEqual({ text: FILE.replace("- [x] Pin 2", "- [ ] Pin 2") })
  })

  test("an item that is not in the file is named, and nothing is changed", () => {
    expect(withTicks(FILE, ["Pin 1 is TXCAN (output)", "Pin 9 is VSS (ground)"], true)).toEqual({ missing: ["Pin 9 is VSS (ground)"] })
  })

  test("ticks count only for the content the file names: a changed part makes every item open", () => {
    expect(openItems(FILE, HASH)).toEqual(["Pin 1 is TXCAN (output)", "Footprint soic18w matches the package drawing"])
    expect(openItems(FILE, "000000000000ffff")).toHaveLength(3)
    expect(openItems("- [x] A\n", HASH)).toEqual(["A"])
  })

  test("clearing the ticks unticks every item and names the new content, the rest unchanged", () => {
    const cleared = withoutTicks(FILE, "abcdef012345ffff")
    expect(cleared).toBe(FILE.replace("- [x] Pin 2", "- [ ] Pin 2").replace("Content: 5cff0330a85f", "Content: abcdef012345"))
    expect(checklistItems(cleared).every((item) => !item.ticked)).toBe(true)
  })
})
