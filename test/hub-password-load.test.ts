import { afterEach, describe, expect, test } from "vitest"
import { CORRECT_PASSWORDS_PER_WINDOW } from "../src/hub/context.js"
import { hashLoad, hashPassword, MAX_CONCURRENT_HASHES, resetHashPeak, verifyPassword } from "../src/hub/secrets.js"
import type { HubServer } from "../src/hub/server.js"
import { Browser, formToken, newUser, startTestHub } from "./helpers/hub-client.js"

let server: HubServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

describe("password hashing is a shared resource", () => {
  test("at most 2 hashes run at once, whatever the route; the rest wait", async () => {
    expect(MAX_CONCURRENT_HASHES).toBe(2)
    const stored = await hashPassword("a good password")
    resetHashPeak()
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => verifyPassword(i === 0 ? "a good password" : `wrong password ${i}`, stored)))
    expect(results).toEqual([true, false, false, false, false, false])
    expect(hashLoad().peak).toBe(2)
    expect(hashLoad().running).toBe(0)
    expect(hashLoad().waiting).toBe(0)
  })

  test("three concurrent sign-ins never have more than two hashes in flight", async () => {
    server = await startTestHub()
    for (const name of ["ada", "bob", "cy"]) await newUser(server, `${name}@example.com`)
    resetHashPeak()
    const hub = server
    const answers = await Promise.all(["ada", "bob", "cy"].map((name) => new Browser(hub.url).signIn(`${name}@example.com`)))
    expect(answers.map((a) => a.status)).toEqual([303, 303, 303])
    expect(hashLoad().peak).toBeLessThanOrEqual(2)
    expect(hashLoad().peak).toBeGreaterThan(0)
  })
})

describe("correct passwords are limited per user", () => {
  test("the 31st correct sign-in in a window is a 429 with Retry-After, and no hash runs for it", async () => {
    expect(CORRECT_PASSWORDS_PER_WINDOW).toBe(30)
    server = await startTestHub()
    await newUser(server, "ada@example.com")
    const before = hashLoad().started
    // newUser's sign-up hashed once; each sign-in is one hash.
    for (let i = 0; i < CORRECT_PASSWORDS_PER_WINDOW; i += 1) expect((await new Browser(server.url).signIn("ada@example.com")).status).toBe(303)
    expect(hashLoad().started - before).toBe(CORRECT_PASSWORDS_PER_WINDOW)
    const refused = await new Browser(server.url).signIn("ada@example.com")
    expect(refused.status).toBe(429)
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0)
    expect(hashLoad().started - before).toBe(CORRECT_PASSWORDS_PER_WINDOW)
    expect(server.hub.store.auditLog(5).map((e) => e.event)).toContain("signin-limited-password")
    // Another user is unaffected.
    await newUser(server, "bob@example.com")
    expect((await new Browser(server.url).signIn("bob@example.com")).status).toBe(303)
  })

  test("current-password checks share the counter, are refused before the hash, and a wrong password follows the old rows", async () => {
    let now = Date.now()
    server = await startTestHub({ now: () => now })
    const ada = await newUser(server, "ada@example.com")
    const userId = server.hub.store.userByEmail("ada@example.com")?.id as string
    // 30 correct checks (a too-short new password: one hash each, nothing written).
    const change = async (current: string) => {
      const page = await ada.get("/account")
      return ada.post("/account/password", { form: formToken(page.text), current, password: "short" })
    }
    for (let i = 0; i < CORRECT_PASSWORDS_PER_WINDOW; i += 1) expect((await change("a good password")).status).toBe(400)
    const before = hashLoad().started
    const refused = await change("a good password")
    expect(refused.status).toBe(429)
    expect(hashLoad().started).toBe(before)
    // After the window, checks work again.
    now += 16 * 60_000
    expect((await change("a good password")).status).toBe(400)
    // Wrong passwords raise only the old failure counter, never the correct-password counter.
    expect(server.hub.limits.correctPasswords.size).toBe(1)
    const wrong = await change("not the password")
    expect(wrong.status).toBe(400)
    expect(wrong.text).toContain("The current password is wrong.")
    expect(server.hub.limits.correctPasswords.check(userId, now).ok).toBe(true)
  })

  test("wrong sign-in passwords never raise the correct-password counter and follow the old limits", async () => {
    server = await startTestHub()
    await newUser(server, "ada@example.com")
    for (let i = 0; i < 10; i += 1) expect((await new Browser(server.url).signIn("ada@example.com", "not the password")).status).toBe(401)
    expect(server.hub.limits.correctPasswords.size).toBe(0)
    // The eleventh failure from this address is the old 429 (address limit), unchanged.
    expect((await new Browser(server.url).signIn("ada@example.com", "not the password")).status).toBe(429)
  })
})
