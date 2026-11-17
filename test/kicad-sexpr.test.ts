import { describe, expect, test } from "vitest"
import { atomText, children, child, numberAt, readSexpr, SexprError, textAt, type SList } from "../src/library/kicad/sexpr.js"

describe("the s-expression reader", () => {
  test("reads nested lists, symbols, numbers and quoted strings", () => {
    const top = readSexpr('(kicad_pcb (version 20260206) (net 3 "GND") (at -1.5 2e1 90))')
    expect(top.list.map((n) => atomText(n) ?? "list")).toEqual(["kicad_pcb", "list", "list", "list"])
    expect(numberAt(child(top, "version") as SList, 1)).toBe(20260206)
    const net = child(top, "net") as SList
    expect(numberAt(net, 1)).toBe(3)
    expect(textAt(net, 2)).toBe("GND")
    const at = child(top, "at") as SList
    expect([numberAt(at, 1), numberAt(at, 2), numberAt(at, 3)]).toEqual([-1.5, 20, 90])
  })

  test("reads escapes inside strings, and brackets and spaces stay text there", () => {
    const top = readSexpr('(a "say \\"hi\\" (now)\\\\" "line\\none" "tab\\tx" "")')
    expect([1, 2, 3, 4].map((i) => textAt(top, i))).toEqual(['say "hi" (now)\\', "line\none", "tab\tx", ""])
  })

  test("a number that is quoted stays text, and a symbol is not a number", () => {
    const top = readSexpr('(pad "1" smd (at x 2))')
    expect(textAt(top, 1)).toBe("1")
    expect(numberAt(child(top, "at") as SList, 1)).toBeUndefined()
  })

  test("lists every child of a name", () => {
    const top = readSexpr("(pts (xy 0 0) (xy 1 0) (arc (start 1 0)) (xy 1 1))")
    expect(children(top, "xy")).toHaveLength(3)
    expect(child(top, "missing")).toBeUndefined()
  })

  test("skips comment lines that start with #", () => {
    const top = readSexpr("# written by hand\n(a\n  # a note (with brackets\n  (b 1))\n")
    expect(numberAt(child(top, "b") as SList, 1)).toBe(1)
  })

  test("a truncated file, an unclosed string and text after the end are refused with the line", () => {
    expect(() => readSexpr("(kicad_pcb\n (version 1)\n (net 1")).toThrow(new SexprError("The file ends before every list is closed: the list opened on line 3 is not closed"))
    expect(() => readSexpr('(a "open\n')).toThrow(new SexprError("A string opened on line 1 is not closed"))
    expect(() => readSexpr("(a) (b)")).toThrow(new SexprError("Line 1 has more after the end of the file's list"))
    expect(() => readSexpr("(a))")).toThrow(new SexprError("Line 1 closes a list that was never opened"))
    expect(() => readSexpr("   ")).toThrow(new SexprError("The file is empty"))
    expect(() => readSexpr("kicad_pcb")).toThrow(new SexprError("The file does not start with a list"))
  })

  test("refuses nesting deeper than it reads, without running out of stack", () => {
    const deep = "(".repeat(5000) + ")".repeat(5000)
    expect(() => readSexpr(deep)).toThrow(/nested deeper than 100 lists/)
  })
})
