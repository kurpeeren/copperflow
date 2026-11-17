import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import type { HistoryListing } from "../src/core/history.js"
import type { ChangeShown } from "../src/studio/change-route.js"
import { CHANGE_VIEW_MESSAGE, changeKey, changeOff, changePath, designFor, sinceMyLast, type ChangeViewState } from "../studio/src/change-view.js"
import { ChangeBar } from "../studio/src/shell/change-bar.js"
import { ShowButton, SinceMine } from "../studio/src/history-show.js"

const entry = (id: string, author: "ai" | "human", summary = `edit ${id}`): HistoryListing => ({ id, author, summary, time: "2026-11-17T10:00:00.000Z", file: "io.circuit.tsx", undone: false })
const design = (x: number) => ({ pcb: { parts: [{ component: "R1", x }] } }) as unknown as NonNullable<ChangeShown["before"]>
const shown: ChangeShown = {
  title: "Change c0002 by the agent: set R1 pcbX=-6",
  lines: [
    { kind: "moved", text: "Moved 1 part: R1", at: { x: -6, y: 0 } },
    { kind: "rule", text: "Rule fabrication.filletRadius: 0.5 to 1" },
  ],
  file: "io.circuit.tsx",
  before: design(-4),
  after: design(-6),
  onBoard: true,
}
const state = (extra: Partial<ChangeViewState> = {}): ChangeViewState => ({ request: { id: "c0002" }, mode: "both", status: "ready", data: shown, ...extra })
const bar = (extra: Partial<ChangeViewState> = {}) => renderToStaticMarkup(createElement(ChangeBar, { state: state(extra), onMode: () => undefined, onLine: () => undefined, onClose: () => undefined }))

describe("the change view's rules", () => {
  test("since my last change: the person's newest change while the agent's came after it; hidden when the newest is the person's", () => {
    expect(sinceMyLast([entry("c0003", "ai"), entry("c0002", "ai"), entry("c0001", "human")])).toBe("c0001")
    expect(sinceMyLast([entry("c0003", "human"), entry("c0002", "ai")])).toBeUndefined()
    expect(sinceMyLast([entry("c0002", "ai")])).toBeUndefined()
    expect(sinceMyLast([])).toBeUndefined()
  })

  test("Escape closes it; nothing else does", () => {
    expect(changeKey("Escape")).toBe("close")
    expect(changeKey("Delete")).toBeUndefined()
  })

  test("while it is shown every editing command is off and says why", () => {
    expect(changeOff(true)["autoroute"]).toBe(CHANGE_VIEW_MESSAGE)
    expect(changeOff(true)["delete"]).toBe(CHANGE_VIEW_MESSAGE)
    expect(changeOff(false)).toEqual({})
    expect(CHANGE_VIEW_MESSAGE).toBe("A change is shown: the board cannot be edited. Close it to edit.")
  })

  test("Before draws the design before; After and Both the design after", () => {
    expect(designFor(shown, "before")).toBe(shown.before)
    expect(designFor(shown, "after")).toBe(shown.after)
    expect(designFor(shown, "both")).toBe(shown.after)
    expect(changePath({ id: "c0002" })).toBe("/api/change?id=c0002")
    expect(changePath({ since: "c0001" })).toBe("/api/change?since=c0001")
  })
})

describe("the change bar", () => {
  test("names the change, has Before / After / Both with the current one pressed, a Close button and says editing is off", () => {
    const html = bar({ mode: "after" })
    expect(html).toContain('role="region" aria-label="Change view"')
    expect(html).toContain("Change c0002 by the agent: set R1 pcbX=-6")
    expect(html).toContain('<button type="button" aria-pressed="false">Before</button>')
    expect(html).toContain('<button type="button" aria-pressed="true">After</button>')
    expect(html).toContain('<button type="button" aria-pressed="false">Both</button>')
    expect(html).toContain('aria-label="Close the change view"')
    expect(html).toContain(CHANGE_VIEW_MESSAGE)
  })

  test("lists the lines: one with a place is a button that centres the view on it", () => {
    const html = bar()
    expect(html).toContain('<button type="button" class="change-line" title="Centre the view on it">Moved 1 part: R1</button>')
    expect(html).toContain("<li>Rule fabrication.filletRadius: 0.5 to 1</li>")
  })

  test("while building it says so; a failure is said; a schematic-only change has no Before / After / Both", () => {
    expect(bar({ status: "loading" })).toContain("Building the change")
    expect(bar({ status: "failed", error: "No change c0042 in the history" })).toContain('role="alert">No change c0042 in the history')
    const sheet = bar({ data: { ...shown, onBoard: false, lines: [{ kind: "note", text: "Nothing on the board changed" }] } })
    expect(sheet).toContain("Nothing on the board changed")
    expect(sheet).not.toContain(">Before</button>")
  })
})

describe("the Log", () => {
  test("each row has Show, a button a screen reader names; Since my last change only when the agent came after", () => {
    const shows: unknown[] = []
    const onShow = (request: unknown) => shows.push(request)
    const html = renderToStaticMarkup(createElement(ShowButton, { entry: entry("c0003", "ai", "set R1 pcbX=-6"), onShow }))
    expect(html).toBe('<button type="button" aria-label="Show change c0003: set R1 pcbX=-6">Show</button>')
    const since = renderToStaticMarkup(createElement(SinceMine, { history: [entry("c0003", "ai"), entry("c0001", "human")], onShow }))
    expect(since).toBe('<p class="history-since"><button type="button">Since my last change</button></p>')
    expect(renderToStaticMarkup(createElement(SinceMine, { history: [entry("c0004", "human"), entry("c0003", "ai")], onShow }))).toBe("")
  })

  test("the Log puts Since my last change above the list and Show on each row", async () => {
    const { readFile } = await import("node:fs/promises")
    const list = await readFile(new URL("../studio/src/HistoryList.tsx", import.meta.url), "utf8")
    expect(list.indexOf("<SinceMine")).toBeLessThan(list.indexOf('<ul className="history">'))
    expect(list).toContain("<ShowButton entry={entry} onShow={onShow} />")
  })
})
