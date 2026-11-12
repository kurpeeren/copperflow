import { afterEach, describe, expect, test } from "vitest"
import { addressKey, GlobalSlowdown, WindowCounter } from "../src/hub/limits.js"
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

describe("the sign-in limits", () => {
  test("a full table evicts the oldest open key, never a limited one, and never refuses a newcomer", () => {
    const counter = new WindowCounter(2, 1000, 2, 1)
    counter.add("attacker", 0)
    counter.add("attacker", 0)
    expect(counter.check("attacker", 1).ok).toBe(false)
    for (const key of ["a", "b", "c", "d"]) expect(counter.add(key, 5)).toBe("ok")
    expect(counter.size).toEqual({ open: 2, limited: 1 })
    expect(counter.check("attacker", 10)).toEqual({ ok: false, retryAfterS: 1 })
    expect(counter.check("a", 10).ok).toBe(true)
    // The limited table is full: a second key reaching its maximum overflows and stays limited in the open table.
    expect(counter.add("d", 6)).toBe("overflow")
    expect(counter.check("d", 7).ok).toBe(false)
    // After the window the limited key is free again.
    expect(counter.check("attacker", 1001).ok).toBe(true)
  })

  test("the global slow-down never refuses, starts past its threshold, and is announced once per window", () => {
    const slow = new GlobalSlowdown(3, 1000)
    for (let i = 0; i < 2; i += 1) slow.fail(0)
    expect(slow.slowed(1)).toBe(false)
    slow.fail(1)
    expect(slow.slowed(2)).toBe(true)
    expect(slow.announce(2)).toBe(true)
    expect(slow.announce(500)).toBe(false)
    expect(slow.slowed(1002)).toBe(false)
    slow.force(2000)
    expect(slow.slowed(2500)).toBe(true)
  })

  test("addresses are keyed by IPv4 address and IPv6 /64", () => {
    expect(addressKey("203.0.113.9")).toBe("203.0.113.9")
    expect(addressKey("::ffff:203.0.113.9")).toBe("203.0.113.9")
    expect(addressKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64")
    expect(addressKey("2001:0db8:0001:0002:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64")
    expect(addressKey("::1")).toBe("0:0:0:0::/64")
  })

  test("past 300 failures everyone still signs in, only slower, and the audit log says so once", async () => {
    server = await startTestHub({ slowDownMs: 300 })
    await newUser(server, "ada@example.com")
    for (let i = 0; i < MAX_FAILED_SIGNINS; i += 1) server.hub.limits.slowdown.fail(Date.now())
    const started = Date.now()
    expect((await new Browser(server.url).signIn("ada@example.com")).status).toBe(303)
    expect(Date.now() - started).toBeGreaterThanOrEqual(290)
    expect((await new Browser(server.url).signIn("ada@example.com")).status).toBe(303)
    expect(server.hub.store.auditLog(10).filter((e) => e.event === "signin-slowed-global")).toHaveLength(1)
  })

  test("per address: 10 failures, then 429 even with the right password", async () => {
    let now = Date.now()
    server = await startTestHub({ now: () => now })
    await newUser(server, "ada@example.com")
    for (let i = 0; i < 10; i += 1) expect((await new Browser(server.url).signIn(`x${i}@example.com`, "wrong password")).status).toBe(401)
    const limited = await new Browser(server.url).signIn("ada@example.com")
    expect(limited.status).toBe(429)
    expect(limited.headers["retry-after"]).toBe("900")
    now += 15 * 60_000 + 1
    expect((await new Browser(server.url).signIn("ada@example.com")).status).toBe(303)
  })

  test("per email: 20 failures from strangers lock out strangers but not the account's own device", async () => {
    server = await startTestHub({ trustProxy: true })
    const ada = await newUser(server, "ada@example.com")
    // Ada signed in once on this browser, so it holds her device cookie.
    await ada.submit("/projects", "/signout", {})
    expect((await ada.signIn("ada@example.com")).status).toBe(303)
    expect(server.hub.store.deviceCount(server.hub.store.userByEmail("ada@example.com")?.id as string)).toBe(1)
    for (let i = 0; i < 20; i += 1) {
      const stranger = new Browser(server.url)
      const token = formToken((await stranger.get("/signin")).text)
      expect((await stranger.post("/signin", { form: token, email: "ada@example.com", password: "wrong password" }, { "x-forwarded-for": `203.0.113.${i}` })).status).toBe(401)
    }
    const stranger = new Browser(server.url)
    const token = formToken((await stranger.get("/signin")).text)
    expect((await stranger.post("/signin", { form: token, email: "ada@example.com", password: "a good password" }, { "x-forwarded-for": "198.51.100.1" })).status).toBe(429)
    await ada.submit("/projects", "/signout", {})
    const adaToken = formToken((await ada.get("/signin")).text)
    expect((await ada.post("/signin", { form: adaToken, email: "ada@example.com", password: "a good password" }, { "x-forwarded-for": "198.51.100.2" })).status).toBe(303)
  })

  test("at most 10 devices are remembered per user", async () => {
    server = await startTestHub()
    await newUser(server, "ada@example.com")
    for (let i = 0; i < 12; i += 1) expect((await new Browser(server.url).signIn("ada@example.com")).status).toBe(303)
    expect(server.hub.store.deviceCount(server.hub.store.userByEmail("ada@example.com")?.id as string)).toBe(10)
  })

  test("the current-password check has its own limiter, keyed on the user, that sign-in cannot use up", async () => {
    let now = Date.now()
    server = await startTestHub({ now: () => now })
    const ada = await newUser(server, "ada@example.com")
    // Strangers failing sign-in for her email do not touch this limiter.
    for (let i = 0; i < 5; i += 1) server.hub.limits.signinEmail.add("ada@example.com", now)
    expect((await ada.submit("/account", "/account/password", { current: "wrong password", password: "another password" })).status).toBe(400)
    for (let i = 0; i < 9; i += 1) {
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
