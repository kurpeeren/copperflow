import { describe, expect, test } from "vitest"
import { OAuthState, PENDING_PER_ADDRESS, PENDING_PER_BROWSER, PROTECTED_PER_USER } from "../src/hub/oauth-state.js"

const request = (clientId: string, userId?: string) => ({ clientId, redirectUri: "https://a.example/cb", challenge: "c".repeat(43), ...(userId ? { userId } : {}) })

describe("which pending authorisations protect a client from eviction", () => {
  test("10 000 unauthenticated authorise requests for distinct clients protect none of them", () => {
    const state = new OAuthState()
    for (let i = 0; i < 10_000; i += 1) expect(state.addRequest(request(`client-${i}`), 0, `browser:${i}`, `a${i}`)).toBeDefined()
    expect(state.pendingClients(1).size).toBe(0)
  })

  test("a request bound to a signed-in user protects its client, at most 5 per user; a live code protects its client", () => {
    const state = new OAuthState()
    for (let i = 0; i < 8; i += 1) state.addRequest(request(`a-${i}`, "u1"), i, `user:u1-${i}`, `a${i}`)
    state.addRequest(request("b-0", "u2"), 0, "user:u2", "b")
    state.addCode({ clientId: "coded", redirectUri: "https://a.example/cb", challenge: "c", userId: "u3", epoch: 0 }, 0)
    const protectedIds = state.pendingClients(1)
    expect([...protectedIds].filter((id) => id.startsWith("a-")).length).toBe(PROTECTED_PER_USER)
    expect(protectedIds.has("b-0")).toBe(true)
    expect(protectedIds.has("coded")).toBe(true)
    expect(state.pendingClients(11 * 60_000).size).toBe(0)
  })
})

describe("pending requests are owned per browser", () => {
  test("a browser holds at most 3 and drops only its own oldest; traffic from the same address never evicts another browser's", () => {
    const state = new OAuthState()
    const victim = state.addRequest(request("v"), 0, "browser:victim", "same-nat") as string
    const mine = Array.from({ length: 5 }, (_, i) => state.addRequest(request(`m-${i}`), 0, "browser:other", "same-nat"))
    expect(state.request(victim, 1)).toBeDefined()
    expect(mine.filter((secret) => secret !== undefined && state.request(secret, 1) !== undefined)).toHaveLength(PENDING_PER_BROWSER)
    // Many browsers behind one address: the address cap refuses new requests, never evicts.
    let refused = 0
    for (let i = 0; i < 40; i += 1) if (state.addRequest(request(`n-${i}`), 0, `browser:n${i}`, "same-nat") === undefined) refused += 1
    expect(refused).toBe(40 - (PENDING_PER_ADDRESS - 4))
    expect(state.request(victim, 1)).toBeDefined()
  })

  test("a request bound to a signed-in user moves to their list, out of anonymous reach", () => {
    const state = new OAuthState()
    const secret = state.addRequest(request("x"), 0, "browser:b", "addr") as string
    expect(state.bindRequest(secret, "u1", 1)?.userId).toBe("u1")
    for (let i = 0; i < 5; i += 1) state.addRequest(request(`y-${i}`), 0, "browser:b", "addr")
    expect(state.request(secret, 1)?.owner).toBe("user:u1")
    expect(state.bindRequest(secret, "u2", 1)).toBeUndefined()
  })

  test("100 000 add-then-drop cycles leave every index empty", () => {
    const state = new OAuthState()
    for (let i = 0; i < 100_000; i += 1) state.dropRequest(state.addRequest(request("c"), 0, `browser:${i}`, `a${i % 7}`))
    expect(state.sizes()).toEqual({ pending: 0, owners: 0, addresses: 0 })
    const taken = state.addRequest(request("c"), 0, "browser:t", "a") as string
    state.takeRequest(taken, 1)
    const expired = state.addRequest(request("c"), 0, "browser:e", "a") as string
    expect(state.request(expired, 11 * 60_000)).toBeUndefined()
    const bound = state.addRequest(request("c"), 0, "browser:f", "a") as string
    state.bindRequest(bound, "u9", 1)
    state.forgetUser("u9")
    expect(state.sizes()).toEqual({ pending: 0, owners: 0, addresses: 0 })
  })
})
