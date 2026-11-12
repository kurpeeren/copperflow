import { describe, expect, test } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HubStore } from "../src/hub/store.js"

const DAY = 24 * 60 * 60_000

async function storeWithUsers(): Promise<HubStore> {
  const store = HubStore.open(join(await mkdtemp(join(tmpdir(), "cf-tokens-")), "hub.db"))
  for (const [id, email] of [["u1", "a@example.com"], ["u2", "b@example.com"]] as const) {
    store.addInvite(`code-${id}`, 0)
    store.signUp(`code-${id}`, { id, email, passwordHash: "x" }, 0)
  }
  return store
}

describe("token store", () => {
  test("personal tokens: at most 10 per user, listed without their hash, revoked by owner only", async () => {
    const store = await storeWithUsers()
    for (let i = 0; i < 10; i += 1) expect(store.tokens.addPersonalToken({ id: `p${i}`, hash: `h${i}`, userId: "u1", name: `t${i}` }, 10, 1000)).toBe("added")
    expect(store.tokens.addPersonalToken({ id: "p10", hash: "h10", userId: "u1", name: "t10" }, 10, 1000)).toBe("full")
    const listed = store.tokens.personalTokens("u1")
    expect(listed).toHaveLength(10)
    expect(JSON.stringify(listed)).not.toContain('"h1"')
    expect(store.tokens.credential("h3", 2000)).toEqual({ userId: "u1", credential: "pat:p3", kind: "pat", expires: null })
    expect(store.tokens.revokePersonalToken("u2", "p3")).toBe(false)
    expect(store.tokens.revokePersonalToken("u1", "p3")).toBe(true)
    expect(store.tokens.credential("h3", 2000)).toBeUndefined()
    store.tokens.touchPersonal("p4", 5000)
    expect(store.tokens.personalTokens("u1").find((t) => t.id === "p4")?.lastUsed).toBe(5000)
  })

  test("clients: a full table evicts the oldest never-used client over an hour old, else refuses", async () => {
    const store = await storeWithUsers()
    const client = (id: string) => ({ id, name: id, redirectUris: ["https://a.example/cb"] })
    expect(store.tokens.addClient(client("c1"), 2, 0)).toBe("added")
    expect(store.tokens.addClient(client("c2"), 2, 10)).toBe("added")
    expect(store.tokens.addClient(client("c3"), 2, 20)).toBe("full")
    store.tokens.createGrant({ id: "g1", userId: "u1", clientId: "c1" }, 30)
    expect(store.tokens.addClient(client("c3"), 2, 2 * 60 * 60_000)).toBe("added")
    expect(store.tokens.client("c2")).toBeUndefined()
    expect(store.tokens.client("c1")?.redirectUris).toEqual(["https://a.example/cb"])
  })

  test("unused clients expire after 30 days; clients with a grant stay", async () => {
    const store = await storeWithUsers()
    store.tokens.addClient({ id: "c1", name: "one", redirectUris: [] }, 100, 0)
    store.tokens.addClient({ id: "c2", name: "two", redirectUris: [] }, 100, 0)
    store.tokens.createGrant({ id: "g1", userId: "u1", clientId: "c2" }, 0)
    store.tokens.issue({ hash: "r1", grantId: "g1", userId: "u1", kind: "refresh", expires: 60 * DAY })
    store.tokens.sweep(31 * DAY)
    expect(store.tokens.client("c1")).toBeUndefined()
    expect(store.tokens.client("c2")).toBeDefined()
  })

  test("oauth tokens: access expires, refresh rotates once, a reused refresh token revokes the grant", async () => {
    const store = await storeWithUsers()
    store.tokens.addClient({ id: "c1", name: "one", redirectUris: [] }, 100, 0)
    store.tokens.createGrant({ id: "g1", userId: "u1", clientId: "c1" }, 0)
    store.tokens.issue({ hash: "a1", grantId: "g1", userId: "u1", kind: "access", expires: 100 })
    store.tokens.issue({ hash: "r1", grantId: "g1", userId: "u1", kind: "refresh", expires: 1000 })
    expect(store.tokens.credential("a1", 50)).toEqual({ userId: "u1", credential: "grant:g1", kind: "access", expires: 100 })
    expect(store.tokens.credential("a1", 100)).toBeUndefined()
    // A refresh token never opens /mcp.
    expect(store.tokens.credential("r1", 50)).toBeUndefined()
    const next = [{ hash: "a2", kind: "access" as const, expires: 300 }, { hash: "r2", kind: "refresh" as const, expires: 2000 }]
    expect(store.tokens.rotateRefresh("r1", "c1", next, 60)).toEqual({ result: "rotated", userId: "u1", grantId: "g1" })
    expect(store.tokens.credential("a2", 70)?.credential).toBe("grant:g1")
    expect(store.tokens.rotateRefresh("r1", "c1", [{ hash: "a3", kind: "access", expires: 300 }], 80)).toEqual({ result: "reused", userId: "u1", grantId: "g1" })
    expect(store.tokens.credential("a2", 90)).toBeUndefined()
    expect(store.tokens.rotateRefresh("r2", "c1", [], 90).result).toBe("missing")
    expect(store.tokens.grants("u1")).toEqual([])
  })

  test("a refresh token presented by another client is refused and changes nothing", async () => {
    const store = await storeWithUsers()
    store.tokens.addClient({ id: "c1", name: "one", redirectUris: [] }, 100, 0)
    store.tokens.createGrant({ id: "g1", userId: "u1", clientId: "c1" }, 0)
    store.tokens.issue({ hash: "r1", grantId: "g1", userId: "u1", kind: "refresh", expires: 1000 })
    expect(store.tokens.rotateRefresh("r1", "c2", [], 10).result).toBe("missing")
    expect(store.tokens.rotateRefresh("r1", "c1", [], 10).result).toBe("rotated")
  })

  test("revoking a user drops grants, OAuth tokens and, unless kept, personal tokens; deleting the user cascades", async () => {
    const store = await storeWithUsers()
    store.tokens.addClient({ id: "c1", name: "one", redirectUris: [] }, 100, 0)
    store.tokens.createGrant({ id: "g1", userId: "u1", clientId: "c1" }, 0)
    store.tokens.issue({ hash: "a1", grantId: "g1", userId: "u1", kind: "access", expires: 100 })
    store.tokens.addPersonalToken({ id: "p1", hash: "h1", userId: "u1", name: "n" }, 10, 0)
    store.tokens.addPersonalToken({ id: "p2", hash: "h2", userId: "u2", name: "n" }, 10, 0)
    store.tokens.revokeUser("u1")
    expect(store.tokens.credential("a1", 1)).toBeUndefined()
    expect(store.tokens.credential("h1", 1)).toBeUndefined()
    expect(store.tokens.credential("h2", 1)?.userId).toBe("u2")
    store.deleteUser("u2")
    expect(store.tokens.credential("h2", 1)).toBeUndefined()
  })

  test("a user holds at most 10 grants: the 11th revokes their least recently used one; grants without a live refresh token are swept", async () => {
    const store = await storeWithUsers()
    for (let i = 0; i < 11; i += 1) store.tokens.addClient({ id: `c${i}`, name: "n", redirectUris: [] }, 100, 0)
    for (let i = 0; i < 10; i += 1) expect(store.tokens.createGrant({ id: `g${i}`, userId: "u1", clientId: `c${i}` }, 10 + i)).toEqual([])
    store.tokens.issue({ hash: "a0", grantId: "g0", userId: "u1", kind: "access", expires: 1000 })
    expect(store.tokens.createGrant({ id: "g10", userId: "u1", clientId: "c10" }, 100)).toEqual(["g0"])
    expect(store.tokens.credential("a0", 50)).toBeUndefined()
    expect(store.tokens.grants("u1")).toHaveLength(10)
    store.tokens.issue({ hash: "r5", grantId: "g5", userId: "u1", kind: "refresh", expires: 500 })
    expect(store.tokens.sweep(400)).toHaveLength(9)
    expect(store.tokens.grants("u1").map((g) => g.id)).toEqual(["g5"])
    expect(store.tokens.sweep(600)).toEqual(["g5"])
    expect(store.tokens.grants("u1")).toEqual([])
  })

  test("a grant is revoked only by its owner, and lists its client's name", async () => {
    const store = await storeWithUsers()
    store.tokens.addClient({ id: "c1", name: "Claude", redirectUris: [] }, 100, 0)
    store.tokens.createGrant({ id: "g1", userId: "u1", clientId: "c1" }, 5)
    expect(store.tokens.grants("u1")).toEqual([{ id: "g1", clientName: "Claude", created: 5, lastUsed: 5 }])
    expect(store.tokens.revokeGrant("u2", "g1")).toBe(false)
    expect(store.tokens.revokeGrant("u1", "g1")).toBe(true)
    expect(store.tokens.credentialLive("grant:g1")).toBe(false)
  })
})
