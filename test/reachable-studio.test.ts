import { describe, expect, test } from "vitest"
import { isFetchBlockedPort, isLostConnect, retryLostConnect } from "./helpers/reachable-studio.js"

const lostConnect = () => Object.assign(new Error("connect ETIMEDOUT 127.0.0.1:1393"), { code: "ETIMEDOUT", syscall: "connect" })
/** What `fetch` throws for it: a generic error whose cause is the socket error. */
const fetchFailed = () => Object.assign(new TypeError("fetch failed"), { cause: lostConnect() })

describe("tests that talk to a studio on a busy Windows host", () => {
  test("ports that fetch refuses are recognised, ordinary ones are not", () => {
    for (const port of [4045, 6000, 6665, 6669, 10080]) expect(isFetchBlockedPort(port)).toBe(true)
    for (const port of [4777, 8080, 42244]) expect(isFetchBlockedPort(port)).toBe(false)
  })

  test("only a connect the system gave up on counts as lost", () => {
    expect(isLostConnect(lostConnect())).toBe(true)
    expect(isLostConnect(fetchFailed())).toBe(true)
    expect(isLostConnect(Object.assign(new Error("read ETIMEDOUT"), { code: "ETIMEDOUT", syscall: "read" }))).toBe(false)
    expect(isLostConnect(Object.assign(new Error("refused"), { code: "ECONNREFUSED", syscall: "connect" }))).toBe(false)
    expect(isLostConnect(new Error("plain"))).toBe(false)
    expect(isLostConnect(undefined)).toBe(false)
  })

  test("sends again after lost connects and returns what the first good send gives", async () => {
    let calls = 0
    const result = await retryLostConnect(async () => {
      if (++calls < 3) throw fetchFailed()
      return "ok"
    })
    expect([result, calls]).toEqual(["ok", 3])
  })

  test("gives the last lost connect back when every attempt is lost", async () => {
    let calls = 0
    await expect(retryLostConnect(async () => (++calls, Promise.reject(lostConnect())), 3)).rejects.toThrow(/ETIMEDOUT/)
    expect(calls).toBe(3)
  })

  test("does not send again after any other error", async () => {
    let calls = 0
    await expect(retryLostConnect(async () => (++calls, Promise.reject(new Error("bad request"))))).rejects.toThrow("bad request")
    expect(calls).toBe(1)
  })
})
