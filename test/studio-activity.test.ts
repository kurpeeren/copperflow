import { describe, expect, test } from "vitest"
import type { AgentActivity } from "../src/studio/activity-event.js"
import type { StudioNote } from "../src/studio/studio-note.js"
import { STUDIO_CACHE_MS, studioLink } from "../src/mcp/studio-activity.js"

const NOTE: StudioNote = { pid: 1, port: 4999, key: "a".repeat(48), root: "/p", started: "2026-11-19T00:00:00.000Z" }
const activity = (message: string, state: AgentActivity["state"] = "running"): AgentActivity => ({ tool: "autoroute", message, state })

function fakes(options: { note?: StudioNote | undefined; takes?: boolean } = {}) {
  let clock = 0
  const finds: number[] = []
  const posted: string[] = []
  const warnings: string[] = []
  let release: (() => void) | undefined
  const link = studioLink({
    root: "/p",
    now: () => clock,
    find: async () => (finds.push(clock), "note" in options ? options.note : NOTE),
    post: async (_note, one) => {
      posted.push(one.message)
      if (one.message === "hold") await new Promise<void>((done) => (release = done))
      return options.takes ?? true
    },
    warn: (line) => warnings.push(line),
  })
  return { link, finds, posted, warnings, tick: (ms: number) => (clock += ms), release: () => release?.() }
}

describe("the Studio link", () => {
  test("the Studio found is kept STUDIO_CACHE_MS before the note is read again", async () => {
    const { link, finds, tick } = fakes()
    expect(await link.present()).toBe(true)
    tick(STUDIO_CACHE_MS - 1)
    await link.present()
    expect(finds).toHaveLength(1)
    tick(1)
    await link.present()
    expect(finds).toHaveLength(2)
  })

  test("no Studio: nothing is posted", async () => {
    const { link, posted } = fakes({ note: undefined })
    expect(await link.present()).toBe(false)
    link.tell(activity("one"))
    await link.settled()
    expect(posted).toEqual([])
  })

  test("while a post is out, newer activities replace each other and only the newest follows", async () => {
    const { link, posted, release } = fakes()
    link.tell(activity("hold"))
    await new Promise((next) => setImmediate(next))
    link.tell(activity("second"))
    link.tell(activity("third", "done"))
    release()
    await link.settled()
    expect(posted).toEqual(["hold", "third"])
  })

  test("a Studio that refuses is looked up again next time, and named once on stderr", async () => {
    const { link, finds, posted, warnings } = fakes({ takes: false })
    link.tell(activity("one"))
    await link.settled()
    link.tell(activity("two"))
    await link.settled()
    expect(posted).toEqual(["one", "two"])
    expect(finds).toHaveLength(2)
    expect(warnings).toEqual(["copperflow mcp: the Studio at 127.0.0.1:4999 did not take the agent's activity; the tools go on without it"])
  })

  test("a lookup that throws counts as no Studio", async () => {
    const link = studioLink({ root: "/p", find: async () => Promise.reject(new Error("disk gone")), post: async () => true })
    expect(await link.present()).toBe(false)
  })
})
