import { afterEach, describe, expect, test } from "vitest"
import type { HubServer } from "../src/hub/server.js"
import { hashPassword } from "../src/hub/secrets.js"
import { Browser, formToken, invite, newUser, ORIGIN, startTestHub } from "./helpers/hub-client.js"

let server: HubServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const cookieLine = (headers: Record<string, string | string[] | undefined>) => ([] as string[]).concat(headers["set-cookie"] ?? []).find((line) => line.includes("copperflow-session")) ?? ""

describe("hub accounts", () => {
  test("signs up with a good invite code once; a used code answers like an unknown one", async () => {
    server = await startTestHub()
    const code = invite(server)
    const first = new Browser(server.url)
    const created = await first.signUp(code, "Ada@Example.com")
    expect(created.status).toBe(303)
    expect(created.headers.location).toBe("/projects")
    expect((await first.get("/projects")).text).toContain("No projects yet.")
    const again = await new Browser(server.url).signUp(code, "bob@example.com")
    const unknown = await new Browser(server.url).signUp("no-such-code", "carl@example.com")
    const taken = await new Browser(server.url).signUp(invite(server), "ada@example.com")
    for (const answer of [again, unknown, taken]) {
      expect(answer.status).toBe(400)
      expect(answer.text).toContain("That invite code cannot be used with that email.")
    }
    expect(server.hub.store.counts().users).toBe(1)
    const short = await new Browser(server.url).signUp(invite(server), "dan@example.com", "short")
    expect(short.text).toContain("The password needs at least 10 characters.")
  })

  test("the session cookie is HttpOnly, SameSite=Lax, Secure and lasts 14 days", async () => {
    server = await startTestHub()
    const created = await new Browser(server.url).signUp(invite(server), "ada@example.com")
    expect(cookieLine(created.headers)).toMatch(/^__Host-copperflow-session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=1209600; HttpOnly; SameSite=Lax; Secure$/)
    await server.close()
    server = await startTestHub({ publicOrigin: "http://127.0.0.1:9999" })
    const plain = await new Browser(server.url, "http://127.0.0.1:9999").signUp(invite(server), "bob@example.com")
    expect(plain.status).toBe(303)
    expect(cookieLine(plain.headers)).toMatch(/^copperflow-session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=1209600; HttpOnly; SameSite=Lax$/)
  })

  test("signs in; a wrong password and an unknown email answer alike", async () => {
    server = await startTestHub()
    await newUser(server, "ada@example.com")
    const browser = new Browser(server.url)
    const wrong = await browser.signIn("ada@example.com", "not the password")
    const unknown = await browser.signIn("nobody@example.com", "not the password")
    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(wrong.text).toContain("The email or password is wrong.")
    expect(unknown.text.replace(/value="[^"]*"/g, "")).toBe(wrong.text.replace(/value="[^"]*"/g, ""))
    const right = await browser.signIn("ADA@example.com")
    expect(right.status).toBe(303)
    expect((await browser.get("/account")).text).toContain("Signed in as ada@example.com.")
  })

  test("limits sign-in attempts to 10 per 15 minutes and says how long to wait", async () => {
    let now = Date.now()
    server = await startTestHub({ now: () => now })
    await newUser(server, "ada@example.com")
    const browser = new Browser(server.url)
    for (let i = 0; i < 10; i += 1) expect((await browser.signIn("ada@example.com", "wrong password")).status).toBe(401)
    const limited = await browser.signIn("ada@example.com")
    expect(limited.status).toBe(429)
    expect(limited.headers["retry-after"]).toBe("900")
    expect(limited.text).toContain("Too many sign-in attempts. Try again in 15 minutes.")
    now += 15 * 60_000 + 1
    expect((await browser.signIn("ada@example.com")).status).toBe(303)
  })

  test("emails are compared after NFC, so two spellings of one address are one account", async () => {
    server = await startTestHub()
    await newUser(server, "rené@example.com")
    const twin = await new Browser(server.url).signUp(invite(server), "rené@example.com")
    expect(twin.status).toBe(400)
    expect(server.hub.store.counts().users).toBe(1)
    expect((await new Browser(server.url).signIn("RENÉ@example.com")).status).toBe(303)
  })

  test("a session ends 30 days after sign-in however much it is used", async () => {
    let now = Date.now()
    server = await startTestHub({ now: () => now })
    const ada = await newUser(server, "ada@example.com")
    for (let day = 0; day < 29; day += 1) {
      now += 24 * 60 * 60_000
      expect((await ada.get("/projects")).status).toBe(200)
    }
    now += 24 * 60 * 60_000
    expect((await ada.get("/projects")).headers.location).toBe("/signin")
  })

  test("a password reset by the maintainer must be changed before anything else", async () => {
    server = await startTestHub()
    await newUser(server, "ada@example.com")
    const id = server.hub.store.userByEmail("ada@example.com")?.id as string
    server.hub.store.setPassword(id, await hashPassword("one time password"), true)
    const ada = new Browser(server.url)
    const signedIn = await ada.signIn("ada@example.com", "one time password")
    expect(signedIn.headers.location).toBe("/account")
    expect((await ada.get("/projects")).headers.location).toBe("/account")
    expect((await ada.get("/account")).text).toContain("Your password was reset. Choose a new one to go on.")
    const token = formToken((await ada.get("/account")).text)
    expect((await ada.post("/projects", { form: token, name: "Amp" })).status).toBe(403)
    expect(server.hub.store.projectCount(id)).toBe(0)
    expect((await ada.submit("/account", "/account/password", { current: "one time password", password: "my own password" })).status).toBe(303)
    expect((await ada.get("/projects")).status).toBe(200)
    expect(server.hub.store.userById(id)?.mustChangePassword).toBe(false)
  })

  test("successful sign-ins are not counted against anyone", async () => {
    server = await startTestHub()
    await newUser(server, "ada@example.com")
    for (let i = 0; i < 25; i += 1) expect((await new Browser(server.url).signIn("ada@example.com")).status).toBe(303)
  })

  test("a request with the session cookie twice is signed out, whichever comes first", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const bob = await newUser(server, "bob@example.com")
    const name = "__Host-copperflow-session"
    const both = `${name}=${bob.jar.get(name)}; ${name}=${ada.jar.get(name)}`
    const answer = await new Browser(server.url).get("/projects", { cookie: both })
    expect(answer.status).toBe(303)
    expect(answer.headers.location).toBe("/signin")
    expect((await ada.get("/projects")).status).toBe(200)
  })

  test("sign-out ends every session of the user", async () => {
    server = await startTestHub()
    const first = await newUser(server, "ada@example.com")
    const second = new Browser(server.url)
    await second.signIn("ada@example.com")
    expect((await second.get("/projects")).status).toBe(200)
    const out = await first.submit("/projects", "/signout", {})
    expect(out.status).toBe(303)
    expect(out.headers.location).toBe("/")
    expect(cookieLine(out.headers)).toMatch(/Max-Age=0/)
    expect((await second.get("/projects")).headers.location).toBe("/signin")
  })

  test("a password change ends the other sessions and keeps this browser signed in", async () => {
    server = await startTestHub()
    const first = await newUser(server, "ada@example.com")
    const second = new Browser(server.url)
    await second.signIn("ada@example.com")
    const wrong = await first.submit("/account", "/account/password", { current: "nope nope nope", password: "another password" })
    expect(wrong.text).toContain("The current password is wrong.")
    const changed = await first.submit("/account", "/account/password", { current: "a good password", password: "another password" })
    expect(changed.status).toBe(303)
    expect((await first.get("/account")).status).toBe(200)
    expect((await second.get("/account")).headers.location).toBe("/signin")
    expect((await new Browser(server.url).signIn("ada@example.com", "another password")).status).toBe(303)
  })

  test("a missing or wrong form token is refused with 403, and so is a cross-site form", async () => {
    server = await startTestHub()
    const browser = await newUser(server, "ada@example.com")
    expect((await browser.post("/projects", { name: "x" })).status).toBe(403)
    expect((await browser.post("/projects", { name: "x", form: "wrong" })).status).toBe(403)
    const token = /name="form" value="([^"]+)"/.exec((await browser.get("/projects")).text)?.[1] as string
    expect((await browser.post("/projects", { name: "x", form: token }, { origin: "https://evil.example" })).status).toBe(403)
    const noOrigin = new Browser(server.url, "")
    for (const [name, value] of browser.jar) noOrigin.jar.set(name, value)
    expect((await noOrigin.post("/projects", { name: "x", form: token }, { "sec-fetch-site": "cross-site" })).status).toBe(403)
    expect((await noOrigin.post("/projects", { name: "x", form: token }, { "sec-fetch-site": "same-origin" })).status).toBe(303)
    await noOrigin.submit("/projects", `/projects/${server.hub.store.projects(server.hub.store.userByEmail("ada@example.com")?.id as string)[0]?.id}/delete`, { confirm: "x" })
    expect(server.hub.store.projects(server.hub.store.userByEmail("ada@example.com")?.id as string)).toEqual([])
    // A sign-in form without its cookie's token is refused too (no login CSRF).
    expect((await new Browser(server.url).post("/signin", { email: "ada@example.com", password: "a good password", form: token })).status).toBe(403)
  })

  test("deletes an account with all its data after the email and password are typed", async () => {
    server = await startTestHub()
    const browser = await newUser(server, "ada@example.com")
    await browser.submit("/projects", "/projects", { name: "Amp" })
    const userId = server.hub.store.userByEmail("ada@example.com")?.id as string
    const wrong = await browser.submit("/account", "/account/delete", { confirm: "someone@example.com", password: "a good password" })
    expect(wrong.text).toContain("Type your email exactly to confirm.")
    const gone = await browser.submit("/account", "/account/delete", { confirm: "ada@example.com", password: "a good password" })
    expect(gone.status).toBe(303)
    expect(server.hub.store.userById(userId)).toBeUndefined()
    expect(server.hub.store.counts()).toMatchObject({ users: 0, projects: 0 })
    expect(await server.hub.files.usage(userId)).toBe(0)
  })

  test("the audit log has the sign-in and never a password, cookie, code or ticket", async () => {
    server = await startTestHub()
    const code = invite(server, "secret-invite-code-123")
    const browser = new Browser(server.url)
    await browser.signUp(code, "ada@example.com", "a secret password")
    await new Browser(server.url).signIn("ada@example.com", "wrong password 1")
    await new Browser(server.url).signIn("ada@example.com", "a secret password")
    const log = server.hub.store.auditLog(50)
    expect(log.map((entry) => entry.event)).toEqual(["signin", "signin-failed", "signup"])
    expect(log[0]).toMatchObject({ address: expect.stringMatching(/127\.0\.0\.1/), detail: "" })
    const text = JSON.stringify(log)
    for (const secret of ["secret-invite-code-123", "a secret password", "wrong password 1", ...browser.jar.values()]) expect(text).not.toContain(secret)
  })

  test("privacy and terms are placeholders the maintainer fills", async () => {
    server = await startTestHub()
    for (const path of ["/privacy", "/terms"]) {
      const page = await new Browser(server.url).get(path)
      expect(page.status).toBe(200)
      expect(page.text).toContain("The maintainer of this service supplies this text")
    }
    expect((await new Browser(server.url).get("/projects")).headers.location).toBe("/signin")
    expect((await new Browser(server.url).get("/")).text).toContain("<h1>Sign in</h1>")
    expect(ORIGIN).toBe("https://cf.example.test")
  })
})
