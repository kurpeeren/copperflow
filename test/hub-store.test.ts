import { afterEach, describe, expect, test } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { formTokenOf, hashPassword, hashSecret, newId, newSecret, sameSecret, verifyAgainstNothing, verifyPassword, ID_PATTERN } from "../src/hub/secrets.js"
import { HubStore } from "../src/hub/store.js"

let store: HubStore | undefined
afterEach(() => {
  store?.close()
  store = undefined
})

async function openStore(): Promise<HubStore> {
  store = HubStore.open(join(await mkdtemp(join(tmpdir(), "cf-store-")), "hub.db"))
  return store
}

describe("hub secrets", () => {
  test("hashes passwords with scrypt, a per-user salt and the stored parameters", async () => {
    const first = await hashPassword("correct horse")
    const second = await hashPassword("correct horse")
    expect(first).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}$/)
    expect(first).not.toBe(second)
    expect(await verifyPassword("correct horse", first)).toBe(true)
    expect(await verifyPassword("correct hors", first)).toBe(false)
    expect(await verifyPassword("correct horse", "scrypt$1099511627776$8$1$AAAA$AAAA")).toBe(false)
    expect(await verifyPassword("x", "plain")).toBe(false)
    expect(await verifyAgainstNothing("anything")).toBe(false)
  })

  test("secrets are 32 random bytes, stored as SHA-256, compared in constant time", () => {
    const secret = newSecret()
    expect(Buffer.from(secret, "base64url")).toHaveLength(32)
    expect(hashSecret(secret)).toMatch(/^[0-9a-f]{64}$/)
    expect(sameSecret("abc", "abc")).toBe(true)
    expect(sameSecret("abc", "abd")).toBe(false)
    expect(sameSecret("abc", "abcd")).toBe(false)
    expect(formTokenOf(secret)).not.toContain(secret)
    expect(newId()).toMatch(ID_PATTERN)
  })
})

describe("the hub store", () => {
  test("signs up with an unused invite code once, and keeps emails unique and lower-cased", async () => {
    const s = await openStore()
    s.addInvite(hashSecret("code-1"), 1)
    s.addInvite(hashSecret("code-2"), 1)
    const user = s.signUp(hashSecret("code-1"), { id: "u1", email: " Ada@Example.COM ", passwordHash: "h" }, 5)
    expect(user).toEqual({ id: "u1", email: "ada@example.com", passwordHash: "h", created: 5 })
    expect(s.signUp(hashSecret("code-1"), { id: "u2", email: "bob@example.com", passwordHash: "h" }, 6)).toBeUndefined()
    expect(s.signUp(hashSecret("code-2"), { id: "u3", email: "ADA@example.com", passwordHash: "h" }, 6)).toBeUndefined()
    expect(s.signUp(hashSecret("nope"), { id: "u4", email: "c@example.com", passwordHash: "h" }, 6)).toBeUndefined()
    expect(s.counts()).toEqual({ users: 1, projects: 0, unusedInvites: 1 })
    expect(s.userByEmail("ADA@EXAMPLE.com")?.id).toBe("u1")
  })

  test("sessions expire, renew, and end one by one or all together", async () => {
    const s = await openStore()
    s.addInvite("c", 0)
    s.signUp("c", { id: "u1", email: "a@b.co", passwordHash: "h" }, 0)
    s.createSession("s1", "u1", 10, 100)
    s.createSession("s2", "u1", 10, 100)
    s.createSession("s3", "u1", 10, 100)
    expect(s.session("s1", 50)).toEqual({ userId: "u1", created: 10, expires: 100, lastSeen: 10 })
    expect(s.session("s1", 100)).toBeUndefined()
    s.renewSession("s2", 60, 200)
    expect(s.session("s2", 150)?.lastSeen).toBe(60)
    s.endSessions("u1", "s2")
    expect(s.session("s3", 50)).toBeUndefined()
    expect(s.sessionCount("u1")).toBe(1)
    s.endSessions("u1")
    expect(s.sessionCount("u1")).toBe(0)
  })

  test("projects belong to one user, with names unique per user", async () => {
    const s = await openStore()
    s.addInvite("c1", 0)
    s.addInvite("c2", 0)
    s.signUp("c1", { id: "u1", email: "a@b.co", passwordHash: "h" }, 0)
    s.signUp("c2", { id: "u2", email: "c@d.co", passwordHash: "h" }, 0)
    expect(s.createProject({ id: "p1", userId: "u1", name: "Amp", created: 1 })).toBe("created")
    expect(s.createProject({ id: "p2", userId: "u1", name: "Amp", created: 1 })).toBe("taken")
    expect(s.createProject({ id: "p3", userId: "u2", name: "Amp", created: 1 })).toBe("created")
    expect(s.createProject({ id: "p5", userId: "u2", name: "Other", created: 1 }, 1)).toBe("full")
    expect(s.project("u2", "p1")).toBeUndefined()
    expect(s.renameProject("u2", "p1", "Mine")).toBe("missing")
    s.createProject({ id: "p4", userId: "u1", name: "Bus", created: 1 })
    expect(s.renameProject("u1", "p4", "Amp")).toBe("taken")
    expect(s.renameProject("u1", "p4", "Can")).toBe("renamed")
    expect(s.projects("u1").map((p) => p.name)).toEqual(["Amp", "Can"])
    expect(s.deleteProject("u2", "p1")).toBe(false)
    s.deleteUser("u1")
    expect(s.projectCount("u1")).toBe(0)
    expect(s.counts().projects).toBe(1)
  })

  test("keeps an audit log, newest first", async () => {
    const s = await openStore()
    s.audit({ time: 1, userId: null, event: "signin-failed", address: "127.0.0.1", detail: "" })
    s.audit({ time: 2, userId: "u1", event: "signin", address: "127.0.0.1", detail: "" })
    expect(s.auditLog(10).map((e) => e.event)).toEqual(["signin", "signin-failed"])
  })
})
