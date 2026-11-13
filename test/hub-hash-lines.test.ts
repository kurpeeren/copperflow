import { afterEach, describe, expect, test } from "vitest"
import { ANONYMOUS_HASH_SLOTS, hashLoad, hashPassword, HASH_LINE_LIMIT, HashBusyError, MAX_CONCURRENT_HASHES, resetHashPeak, verifyPassword } from "../src/hub/secrets.js"
import type { HubServer } from "../src/hub/server.js"
import { Browser, formToken, invite, newUser, send, startTestHub } from "./helpers/hub-client.js"

let server: HubServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

describe("the hashing lines", () => {
  test("the numbers: 2 slots, 1 for anonymous work, lines of 16 and 64", () => {
    expect(MAX_CONCURRENT_HASHES).toBe(2)
    expect(ANONYMOUS_HASH_SLOTS).toBe(1)
    expect(HASH_LINE_LIMIT).toEqual({ anonymous: 16, account: 64 })
  })

  test("the account line holds 64 waiting; the next is refused with HashBusyError (503, Retry-After 2)", async () => {
    const stored = await hashPassword("a good password")
    resetHashPeak()
    // Two start at once, 64 wait, the rest are refused at once.
    const runs = await Promise.allSettled(Array.from({ length: 70 }, () => verifyPassword("a good password", stored)))
    const refused = runs.filter((run) => run.status === "rejected")
    expect(refused).toHaveLength(70 - MAX_CONCURRENT_HASHES - 64)
    for (const run of refused) {
      const reason = (run as PromiseRejectedResult).reason as HashBusyError
      expect(reason).toBeInstanceOf(HashBusyError)
      expect(reason.retryAfterS).toBe(2)
    }
    expect(hashLoad().peak).toBeLessThanOrEqual(2)
    expect(hashLoad().running).toBe(0)
  }, 120_000)

  test("anonymous work holds one slot at most and has a line of 16: with 17 anonymous hashes asked, an account hash still runs at once", async () => {
    const stored = await hashPassword("a good password")
    const anonymous = Array.from({ length: 1 + 16 + 2 }, () => verifyPassword("x", stored, "anonymous").then(() => "done", () => "refused"))
    expect(hashLoad().waitingAnonymous).toBe(16)
    const before = hashLoad().started
    const started = Date.now()
    expect(await verifyPassword("a good password", stored)).toBe(true)
    // It waited for no anonymous hash but the one already running: well before the 17 would have finished one by one.
    expect(Date.now() - started).toBeLessThan(2000)
    expect(hashLoad().started).toBeGreaterThan(before)
    const results = await Promise.all(anonymous)
    expect(results.filter((r) => r === "refused")).toHaveLength(2)
    expect(results.filter((r) => r === "done")).toHaveLength(17)
  }, 120_000)
})

describe("sign-up", () => {
  async function signUpAt(base: string, cookie: string, token: string, code: string, email: string) {
    const body = new URLSearchParams({ form: token, code, email, password: "a good password" }).toString()
    return send(base, "POST", "/signup", { host: new URL("https://cf.example.test").host, "content-type": "application/x-www-form-urlencoded", origin: "https://cf.example.test", cookie }, body)
  }

  test("a sign-up without a usable invite never reaches the hash, and the answer is the same", async () => {
    server = await startTestHub()
    const used = invite(server)
    await new Browser(server.url).signUp(used, "first@example.com")
    const before = hashLoad().started
    for (const code of ["", "nope", used]) {
      const answer = await new Browser(server.url).signUp(code, `x${code.length}@example.com`)
      expect(answer.status).toBe(400)
      expect(answer.text).toContain("That invite code cannot be used with that email.")
    }
    expect(hashLoad().started).toBe(before)
  })

  test("18 concurrent sign-ups with valid invites: the 18th is a 503 with Retry-After 2, and a sign-in arriving then is served before the sign-ups finish", async () => {
    server = await startTestHub()
    await newUser(server, "ada@example.com")
    const hub = server
    // Each browser fetches its form first, so the 18 posts reach the hash together.
    const prepared = await Promise.all(
      Array.from({ length: 18 }, async (_, i) => {
        const browser = new Browser(hub.url)
        const page = await browser.get("/signup")
        const cookie = browser.cookie()
        return { cookie, token: formToken(page.text), code: invite(hub), email: `u${i}@example.com` }
      }),
    )
    const finished: number[] = []
    const t0 = Date.now()
    const signUps = prepared.map((p) => signUpAt(hub.url, p.cookie, p.token, p.code, p.email).then((a) => (finished.push(Date.now() - t0), a)))
    await new Promise((r) => setTimeout(r, 150))
    let signInDone = 0
    const signIn = new Browser(hub.url).signIn("ada@example.com").then((a) => ((signInDone = Date.now() - t0), a))
    const answers = await Promise.all(signUps)
    expect((await signIn).status).toBe(303)
    const statuses = answers.map((a) => a.status).sort()
    expect(statuses.filter((s) => s === 503)).toHaveLength(1)
    expect(statuses.filter((s) => s === 303)).toHaveLength(17)
    const busy = answers.find((a) => a.status === 503)
    expect(busy?.headers["retry-after"]).toBe("2")
    // The sign-in did not wait behind all the sign-ups.
    expect(signInDone).toBeLessThan(Math.max(...finished))
  }, 120_000)
})
