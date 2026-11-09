import { describe, expect, test } from "vitest"
import { announceHistoryWrite, onHistoryWrite, type WriteOutcome } from "../studio/src/history-writes.js"

describe("the Undo and Redo bridge", () => {
  test("every listener hears the write as it is sent and gets its outcome; the caller gets the same outcome", async () => {
    const heard: Promise<WriteOutcome>[] = []
    const stop = onHistoryWrite((outcome) => void heard.push(outcome))
    const outcome = Promise.resolve({ ok: true, mark: 4 })
    expect(announceHistoryWrite(outcome)).toBe(outcome)
    expect(heard).toEqual([outcome])
    expect(await heard[0]).toEqual({ ok: true, mark: 4 })
    stop()
    announceHistoryWrite(Promise.resolve({ ok: false }))
    expect(heard).toHaveLength(1)
  })
})
