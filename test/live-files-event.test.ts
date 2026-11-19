// The "files" event: any change in the project the Files tab shows tells the viewers once the changes settle, so the
// tree stays current while the agent writes; changes under the folders the list leaves out say nothing.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { Design } from "../src/engine/design.js"
import { FILES_DEBOUNCE_MS, LiveProject, type LiveEvent } from "../src/studio/live.js"

/** Long enough for the watcher to report a change and the debounce to run out. */
const SETTLE_MS = FILES_DEBOUNCE_MS * 4
let root: string
let live: LiveProject | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-live-files-"))
  await mkdir(join(root, "parts"))
  await mkdir(join(root, ".git"))
  await mkdir(join(root, "node_modules"))
})

afterEach(() => live?.stop())

function watched(): LiveEvent[] {
  live = new LiveProject(root, { build: async () => ({}) as Design })
  const events: LiveEvent[] = []
  live.subscribe((event) => events.push(event))
  live.start()
  return events
}

const settle = () => new Promise((done) => setTimeout(done, SETTLE_MS))

describe("the files event", () => {
  test("a burst of writes in the project sends one files event", async () => {
    const events = watched()
    await writeFile(join(root, "PROJECT.md"), "# P\n")
    await writeFile(join(root, "parts", "notes.txt"), "a")
    await writeFile(join(root, "parts", "notes.txt"), "b")
    await vi.waitFor(() => expect(events.filter((event) => event === "files")).toHaveLength(1), { timeout: 5000 })
    await settle()
    expect(events.filter((event) => event === "files")).toHaveLength(1)
  })

  test("changes under .git and node_modules send none", async () => {
    const events = watched()
    await writeFile(join(root, ".git", "HEAD"), "ref")
    await writeFile(join(root, "node_modules", "x.js"), "x")
    await settle()
    expect(events).not.toContain("files")
  })
})
