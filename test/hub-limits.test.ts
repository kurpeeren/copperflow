import { afterEach, describe, expect, test } from "vitest"
import { addressKey, RateLimiter } from "../src/hub/limits.js"
import { MAX_FAILED_SIGNINS } from "../src/hub/context.js"
import type { HubServer } from "../src/hub/server.js"
import { ZipWriter } from "../src/hub/zip.js"
import { Browser, formToken, newUser, startTestHub } from "./helpers/hub-client.js"

let server: HubServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function zipOf(bytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  const zip = new ZipWriter(async (chunk) => void chunks.push(chunk))
  // Random-looking bytes so the archive is not refused for its ratio.
  await zip.add("data.bin", Buffer.from(Array.from({ length: bytes }, (_, i) => (i * 7919) % 251)), new Date(0))
  await zip.finish()
  return Buffer.concat(chunks)
}

describe("the rate limiter fails closed", () => {
  test("a limited key is never evicted; a full table refuses a new key; spent keys are swept", () => {
    const limiter = new RateLimiter(2, 1000, 3)
    limiter.hit("attacker", 0)
    limiter.hit("attacker", 0)
    expect(limiter.hit("attacker", 1).ok).toBe(false)
    limiter.hit("a", 0)
    limiter.hit("b", 0)
    expect(limiter.hit("c", 10)).toEqual({ ok: false, retryAfterS: 1 })
    expect(limiter.hit("attacker", 10).ok).toBe(false)
    // Once every attempt has left the window the keys are swept and a new one fits.
    expect(limiter.hit("c", 1500).ok).toBe(true)
    expect(limiter.size).toBeLessThanOrEqual(3)
  })

  test("addresses are keyed by IPv4 address and IPv6 /64", () => {
    expect(addressKey("203.0.113.9")).toBe("203.0.113.9")
    expect(addressKey("::ffff:203.0.113.9")).toBe("203.0.113.9")
    expect(addressKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64")
    expect(addressKey("2001:0db8:0001:0002:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64")
    expect(addressKey("::1")).toBe("0:0:0:0::/64")
  })

  test("the global cap on failed sign-ins answers 429 for everyone and is in the audit log", async () => {
    server = await startTestHub()
    await newUser(server, "ada@example.com")
    for (let i = 0; i < MAX_FAILED_SIGNINS; i += 1) server.hub.limits.signinFailures.hit("all", Date.now())
    const answer = await new Browser(server.url).signIn("ada@example.com")
    expect(answer.status).toBe(429)
    expect(answer.text).toContain("Too many sign-in attempts.")
    expect(server.hub.store.auditLog(1)[0]?.event).toBe("signin-limited-global")
  })

  test("the current-password check is limited like sign-in", async () => {
    let now = Date.now()
    server = await startTestHub({ now: () => now })
    const ada = await newUser(server, "ada@example.com")
    for (let i = 0; i < 10; i += 1) {
      expect((await ada.submit("/account", "/account/password", { current: "wrong password", password: "another password" })).status).toBe(400)
    }
    const limited = await ada.submit("/account", "/account/password", { current: "a good password", password: "another password" })
    expect(limited.status).toBe(429)
    expect(limited.headers["retry-after"]).toBe("900")
    expect(limited.text).toContain("Too many password attempts. Try again in 15 minutes.")
    const del = await ada.submit("/account", "/account/delete", { confirm: "ada@example.com", password: "a good password" })
    expect(del.status).toBe(429)
    expect(server.hub.store.auditLog(2).map((e) => e.event)).toEqual(["account-delete-limited", "password-change-limited"])
    now += 15 * 60_000 + 1
    expect((await ada.submit("/account", "/account/password", { current: "a good password", password: "another password" })).status).toBe(303)
  })
})

describe("quotas under concurrency", () => {
  test("10 concurrent creates at 19 projects leave exactly 20", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const userId = server.hub.store.userByEmail("ada@example.com")?.id as string
    for (let i = 0; i < 19; i += 1) server.hub.store.createProject({ id: `${i}`.padStart(32, "a"), userId, name: `p${i}`, created: 0 })
    const token = formToken((await ada.get("/projects")).text)
    const answers = await Promise.all(Array.from({ length: 10 }, (_, i) => ada.post("/projects", { form: token, name: `new ${i}` })))
    expect(answers.filter((a) => a.status === 303)).toHaveLength(1)
    expect(answers.filter((a) => a.status === 403)).toHaveLength(9)
    expect(server.hub.store.projectCount(userId)).toBe(20)
  })

  test("two concurrent uploads that each fit but together exceed the byte quota: one is refused", async () => {
    server = await startTestHub({ maxBytes: 30_000 })
    const ada = await newUser(server, "ada@example.com")
    const archive = await zipOf(20_000)
    const token = formToken((await ada.get("/projects")).text)
    const answers = await Promise.all([ada.upload("one", archive, token), ada.upload("two", archive, token)])
    expect(answers.map((a) => a.status).sort()).toEqual([303, 400])
    expect(answers.find((a) => a.status === 400)?.text).toContain("unpacks to more than")
    const userId = server.hub.store.userByEmail("ada@example.com")?.id as string
    expect(await server.hub.files.usage(userId)).toBe(20_000)
  })
})
