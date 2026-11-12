import { afterEach, describe, expect, test } from "vitest"
import { join } from "node:path"
import { runCli } from "../src/cli-commands.js"
import { addressKey, SigninGate, WindowCounter } from "../src/hub/limits.js"
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
  test("a full table never forgets a live key and never refuses: the newcomer is not counted and says full", () => {
    const counter = new WindowCounter(2, 1000, 1)
    counter.add("attacker", 0)
    counter.add("attacker", 0)
    expect(counter.add("a", 5)).toBe("full")
    expect(counter.check("attacker", 10)).toEqual({ ok: false, retryAfterS: 1 })
    expect(counter.check("a", 10).ok).toBe(true)
    expect(counter.add("c", 7)).toBe("full")
    // Spent keys are dropped to make room.
    expect(counter.add("c", 1001)).toBe("ok")
    expect(counter.check("attacker", 1001).ok).toBe(true)
    counter.add("r", 1002)
    counter.refund("r", 1002)
    expect(counter.check("r", 1003).ok).toBe(true)
  })

  test("strict mode: over the threshold, a token bucket with a short queue, said once per window", async () => {
    const gate = new SigninGate({ threshold: 3, windowMs: 1000, perSecond: 5, queue: 2, perAddress: 2 })
    for (let i = 0; i < 3; i += 1) gate.fail(0)
    expect(gate.strict(1)).toBe(false)
    gate.fail(1)
    expect(gate.strict(2)).toBe(true)
    expect(gate.announce(2)).toBe(true)
    expect(gate.announce(500)).toBe(false)
    expect(gate.strict(1002)).toBe(false)
    const passes = Array.from({ length: 5 }, () => gate.pass("a"))
    const first = await Promise.all(passes)
    expect(first.every(Boolean)).toBe(true)
    const waiting = [gate.pass("a"), gate.pass("b")]
    expect(await gate.pass("c")).toBe(false)
    expect(await Promise.all(waiting)).toEqual([true, true])
    gate.enterStrict(5000)
    expect(gate.strict(5500)).toBe(true)
  })

  test("the gate's queue is fair: 2 waiting per address, served in turn across addresses", async () => {
    const gate = new SigninGate({ threshold: 1, windowMs: 1000, perSecond: 5, queue: 50, perAddress: 2 })
    for (let i = 0; i < 5; i += 1) await gate.pass("flood")
    const order: string[] = []
    const flood = [gate.pass("flood"), gate.pass("flood")]
    expect(await gate.pass("flood")).toBe(false)
    const person = gate.pass("person").then((ok) => (order.push("person"), ok))
    void flood[0]?.then(() => order.push("flood"))
    void flood[1]?.then(() => order.push("flood"))
    expect(await Promise.all([...flood, person])).toEqual([true, true, true])
    expect(order.indexOf("person")).toBeLessThan(2)
  })

  test("an unknown email counts toward its address only", async () => {
    server = await startTestHub()
    for (let i = 0; i < 5; i += 1) await new Browser(server.url).signIn(`nobody${i}@example.com`, "wrong password")
    expect(server.hub.limits.signinEmail.size).toBe(0)
    expect(server.hub.limits.signinAddress.size).toBe(1)
  })

  test("addresses are keyed by IPv4 address and IPv6 /64", () => {
    expect(addressKey("203.0.113.9")).toBe("203.0.113.9")
    expect(addressKey("::ffff:203.0.113.9")).toBe("203.0.113.9")
    expect(addressKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64")
    expect(addressKey("2001:0db8:0001:0002:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64")
    expect(addressKey("::1")).toBe("0:0:0:0::/64")
  })

  test("in strict mode a stranger still signs in through the bucket, and the audit log says so once", async () => {
    server = await startTestHub()
    await newUser(server, "ada@example.com")
    for (let i = 0; i <= MAX_FAILED_SIGNINS; i += 1) server.hub.limits.gate.fail(Date.now())
    expect((await new Browser(server.url).signIn("ada@example.com")).status).toBe(303)
    expect((await new Browser(server.url).signIn("ada@example.com")).status).toBe(303)
    expect(server.hub.store.auditLog(10).filter((e) => e.event === "signin-strict")).toHaveLength(1)
  })

  test("a full limiter table turns strict mode on instead of refusing", async () => {
    server = await startTestHub({ limiterKeys: 1 })
    await newUser(server, "ada@example.com")
    expect((await new Browser(server.url).signIn("ada@example.com", "wrong password")).status).toBe(401)
    expect(server.hub.limits.gate.strict(Date.now())).toBe(false)
    // A second account's email does not fit the one-key table: it is not counted, and strict mode turns on.
    await newUser(server, "bob@example.com")
    expect((await new Browser(server.url).signIn("bob@example.com", "wrong password")).status).toBe(401)
    expect(server.hub.limits.gate.strict(Date.now())).toBe(true)
    expect(server.hub.store.auditLog(5).map((e) => e.event)).toContain("signin-strict-table-full")
    expect((await new Browser(server.url).signIn("ada@example.com")).status).toBe(303)
  })

  test("50 concurrent wrong passwords from one address run at most 10 verifications", async () => {
    server = await startTestHub()
    await newUser(server, "ada@example.com")
    const browser = new Browser(server.url)
    const token = formToken((await browser.get("/signin")).text)
    const answers = await Promise.all(Array.from({ length: 50 }, () => browser.post("/signin", { form: token, email: "ada@example.com", password: "wrong password" })))
    expect(answers.filter((a) => a.status === 401)).toHaveLength(10)
    expect(answers.filter((a) => a.status === 429)).toHaveLength(40)
    expect(server.hub.store.auditLog(100).filter((e) => e.event === "signin-failed")).toHaveLength(10)
  })

  test("device cookies are revoked with the sessions", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const id = server.hub.store.userByEmail("ada@example.com")?.id as string
    const signInAgain = async () => {
      expect((await ada.signIn("ada@example.com", password)).status).toBe(303)
      expect(server?.hub.store.deviceCount(id)).toBe(1)
    }
    let password = "a good password"
    await signInAgain()
    // A normal sign-out keeps the device; "End all sessions" forgets it.
    await ada.submit("/projects", "/signout", {})
    expect(server.hub.store.deviceCount(id)).toBe(1)
    await signInAgain()
    await ada.submit("/account", "/account/end-sessions", {})
    expect(server.hub.store.deviceCount(id)).toBe(0)
    expect(server.hub.store.sessionCount(id)).toBe(0)
    await signInAgain()
    await ada.submit("/account", "/account/password", { current: password, password: "another password" })
    password = "another password"
    expect(server.hub.store.deviceCount(id)).toBe(0)
    await signInAgain()
    const out = { lines: [] as string[], errors: [] as string[] }
    const data = join(server.hub.files.root, "..")
    expect(await runCli(["hub", "reset-password", "ada@example.com", "--data", data], "/", { out: (t) => out.lines.push(t), err: (t) => out.errors.push(t) })).toBe(0)
    expect(server.hub.store.deviceCount(id)).toBe(0)
    password = out.lines[1] as string
    await signInAgain()
    // The reset password must be replaced first; that is a password change, which forgets the devices too.
    await ada.submit("/account", "/account/password", { current: password, password: "a third password" })
    password = "a third password"
    expect(server.hub.store.deviceCount(id)).toBe(0)
    await signInAgain()
    await ada.submit("/account", "/account/delete", { confirm: "ada@example.com", password })
    expect(server.hub.store.deviceCount(id)).toBe(0)
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
    const adaToken = ada.jar.get("__Host-copperflow-form") as string
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
