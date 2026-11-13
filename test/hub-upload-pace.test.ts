import { describe, expect, test } from "vitest"
import { PassThrough } from "node:stream"
import { MAX_UPLOADS, paced, UPLOAD_MAX_MS, UPLOAD_WINDOW_BYTES, UPLOAD_WINDOW_MS } from "../src/hub/project-routes.js"

function fakeRequest(): PassThrough & { destroyed: boolean } {
  const source = new PassThrough()
  return Object.assign(source, { setTimeout: (ms: number, then: () => void) => setTimeout(then, ms).unref() }) as never
}

const LIMITS = { idleMs: 60_000, minBytesPerS: 0, rateAfterMs: 1e9, checkMs: 10, windowMs: 100, windowBytes: 1000, maxMs: 1e9 }

async function readAll(source: PassThrough, limits: typeof LIMITS, feed: () => Promise<void>): Promise<void> {
  const reading = (async () => {
    for await (const chunk of paced(source as never, limits).body) void chunk
  })()
  const fed = feed().then(() => source.end())
  await Promise.all([reading, fed.catch(() => undefined)])
}

describe("the upload's pace", () => {
  test("the limits are 262 144 bytes in any 30 seconds and 15 minutes in all, one upload per user and four in the hub", () => {
    expect(UPLOAD_WINDOW_BYTES).toBe(262_144)
    expect(UPLOAD_WINDOW_MS).toBe(30_000)
    expect(UPLOAD_MAX_MS).toBe(15 * 60_000)
    expect(MAX_UPLOADS).toBe(4)
  })

  test("a body that keeps up with the window is read to its end", async () => {
    const source = fakeRequest()
    // 400 bytes every 20 ms is eight times what a 400 ms window asks for, so one late timer on a busy machine does
    // not make a body that keeps up look slow; 600 ms of it crosses the window more than once.
    await readAll(source, { ...LIMITS, windowMs: 400 }, async () => {
      for (let i = 0; i < 30; i += 1) {
        source.write(Buffer.alloc(400))
        await new Promise((r) => setTimeout(r, 20))
      }
    })
  })

  test("a body that sends a burst and then trickles is stopped as too slow, even though its average is high", async () => {
    const source = fakeRequest()
    const slow = { ...LIMITS, minBytesPerS: 10, rateAfterMs: 50 }
    await expect(
      readAll(source, slow, async () => {
        source.write(Buffer.alloc(1_000_000))
        for (let i = 0; i < 40; i += 1) {
          source.write(Buffer.alloc(1))
          await new Promise((r) => setTimeout(r, 20))
        }
      }),
    ).rejects.toThrow("The upload was too slow and was stopped.")
  })

  test("an upload ends after the total time limit however fast it is", async () => {
    const source = fakeRequest()
    await expect(
      readAll(source, { ...LIMITS, windowBytes: 1, maxMs: 150 }, async () => {
        for (let i = 0; i < 100; i += 1) {
          source.write(Buffer.alloc(10_000))
          await new Promise((r) => setTimeout(r, 10))
        }
      }),
    ).rejects.toThrow("The upload took too long")
  })
})
