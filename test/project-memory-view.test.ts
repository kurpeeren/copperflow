import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { EMPTY_PROJECT } from "../src/core/project-text.js"
import { memoryView, MISSING_NOTE } from "../studio/src/shell/project-memory.js"
import { showDesignSub } from "../studio/src/shell/strip-state.js"

describe("the Project tab", () => {
  test("without PROJECT.md it says how one comes", () => {
    expect(memoryView(null)).toEqual({ kind: "missing", note: MISSING_NOTE })
  })

  test("shows the title and every section in file order, bullets as their text, empty sections empty", () => {
    const text = "# CAN module\r\n\r\nNotes.\r\n\r\n## Intent\r\n\r\nA CAN node.\r\n\r\n## Decisions\r\n\r\n- 2026-11-11 3.3 V\r\n* second\r\n\r\n## Links\r\n\r\nhttp://x\r\n"
    expect(memoryView(text)).toEqual({
      kind: "file",
      title: "CAN module",
      sections: [
        { title: "Intent", lines: ["A CAN node."] },
        { title: "Decisions", lines: ["2026-11-11 3.3 V", "second"] },
        { title: "Links", lines: ["http://x"] },
      ],
    })
    const empty = memoryView(EMPTY_PROJECT)
    expect(empty.kind === "file" && empty.sections.map((s) => [s.title, s.lines.length])).toEqual([["Intent", 0], ["Blocks", 0], ["Decisions", 0], ["Open", 0]])
  })

  test("is a sub-tab of Project Design, and its styles use theme tokens only", () => {
    expect(showDesignSub("project")).toEqual({ strip: "design", sub: "project", open: true })
    const css = readFileSync(new URL("../studio/src/left-panel.css", import.meta.url), "utf8")
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/)
  })
})
